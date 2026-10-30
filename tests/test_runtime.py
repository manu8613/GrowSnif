"""End-to-end test: tiny local MQTT broker + simulated gateway on 127.0.0.1. Needs paho-mqtt."""
import json,os,socket,struct,subprocess,sys,tempfile,threading,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'growsnif'))
from protocol import crc
import struct as _s
messages=[];sent_by_receiver=[];halt=threading.Event()
def listener():
 s=socket.socket();s.bind(('127.0.0.1',0));s.listen();s.settimeout(.2);return s
broker=listener();wave=listener()
def exact(c,n):
 b=b''
 while len(b)<n:
  part=c.recv(n-len(b))
  if not part:raise EOFError
  b+=part
 return b

def mqtt_server():
 try:
  while not halt.is_set():
   try:c,_=broker.accept();break
   except socket.timeout:continue
  else:return
  with c:
   c.settimeout(10)
   while not halt.is_set():
    h=exact(c,1)[0];size=0;mult=1
    while True:
     z=exact(c,1)[0];size+=(z&127)*mult;mult*=128
     if z<128:break
    p=exact(c,size);typ=h>>4
    if typ==1:c.sendall(b'\x20\x02\x00\x00')
    elif typ==8:c.sendall(b'\x90\x03'+p[:2]+b'\x00')
    elif typ==3:
     n=int.from_bytes(p[:2],'big');topic=p[2:2+n].decode();pos=2+n
     if (h>>1)&3:
      packet=p[pos:pos+2];pos+=2;c.sendall(b'\x40\x02'+packet)
     messages.append((topic,p[pos:].decode()))
    elif typ==12:c.sendall(b'\xd0\x00')
    elif typ==14:break
 except (EOFError,OSError):pass

def wave_server():
 try:
  while not halt.is_set():
   try:c,_=wave.accept();break
   except socket.timeout:continue
  else:return
  with c:
   c.settimeout(.01)
   def fr(b):return b+crc(b).to_bytes(2,'little')
   q=fr(bytes([7,3,0x20,0x12,0,2]));r=fr(bytes([7,3,4])+_s.pack('>f',1500.0))
   while not halt.is_set():
    c.sendall(q[:3]);c.sendall(q[3:]+r)
    try:
     b=c.recv(100)
     if not b:break
     sent_by_receiver.append(b)
    except socket.timeout:pass
    time.sleep(.15)
 except OSError:pass

for target in (mqtt_server,wave_server):threading.Thread(target=target,daemon=True).start()
with tempfile.TemporaryDirectory() as tmp:
 path=Path(tmp)/'options.json';path.write_text(json.dumps(dict(gateway_host='127.0.0.1',gateway_port=wave.getsockname()[1],meter_address=7,mqtt_host='127.0.0.1',mqtt_port=broker.getsockname()[1],mqtt_username='test',mqtt_password='test',ct_ratio=80,publish_interval=1,invert_power_sign=False,id_prefix='prueba',device_name='Prueba')))
 proc=subprocess.Popen([sys.executable,str(Path(__file__).resolve().parent.parent/'growsnif/main.py')],env={**os.environ,'GROWSNIF_OPTIONS':str(path)},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   if sum(t=='prueba/state/potencia_total' for t,p in messages)>=3:break
   if proc.poll() is not None:raise AssertionError(proc.communicate())
   time.sleep(.1)
 finally:
  proc.terminate();out,err=proc.communicate(timeout=5);halt.set();broker.close();wave.close()
 assert proc.returncode==0,err.decode()
 assert not sent_by_receiver,sent_by_receiver
 configs=[json.loads(p) for t,p in messages if t.endswith('/config')]
 assert len(configs)==30,len(configs)
 assert all(c['unique_id'].startswith('prueba_') for c in configs)
 assert any(t.endswith('/potencia_total') and float(p)==12000 for t,p in messages)
 assert any(t.endswith('/potencia_exportada') and float(p)==0 for t,p in messages)
 assert messages[-1]==('prueba/availability','offline'),messages[-1]
 for c in configs:
  if c.get('device_class')=='energy':assert c['state_class']=='total_increasing' and c['unit_of_measurement']=='kWh'
 print('OK: 30 discovery configs, TCP fragmentation, MQTT values, clean offline, ZERO application bytes to Waveshare.')
