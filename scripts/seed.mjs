import nextEnv from '@next/env'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
nextEnv.loadEnvConfig(process.cwd())
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
if (!email || !password || password.length < 14) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (14+ characters) before seeding.')
const configured = process.env.DATABASE_URL || 'file:./data/medicare.db'
if (!configured.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL.')
const file = join(process.cwd(), 'data', basename(configured.slice('file:'.length)))
mkdirSync(dirname(file), { recursive: true })
const db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys=ON')
const id = () => randomUUID()
try {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) throw new Error('Run npm run db:migrate first.')
  if (process.env.NODE_ENV === 'production') throw new Error('Fictional demo data seeding is disabled in production.')
  const hash = await bcrypt.hash(password, 12)
  const userId = db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id || id()
  db.prepare('INSERT OR IGNORE INTO users(id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,1)').run(userId,'Hospital Administrator',email,hash,'HOSPITAL_ADMIN')
  const departments=['Cardiology','Neurology','Pediatrics','Orthopedics','Dermatology','General Medicine','Gynecology','ENT']
  const doctors=[['Ananya Rao','Cardiology'],['Karthik Menon','Neurology'],['Meera Iyer','Pediatrics'],['Rohan Mehta','Orthopedics'],['Divya Shetty','Dermatology'],['Arjun Patel','General Medicine'],['Sneha Reddy','Gynecology'],['Vikram Nair','ENT']]
  for (const name of departments) db.prepare('INSERT OR IGNORE INTO departments(id,name,description) VALUES(?,?,?)').run(id(),name,`${name} department`)
  for (const [name,specialty] of doctors) {
    const departmentId=db.prepare('SELECT id FROM departments WHERE name=?').get(specialty).id
    const doctorEmail=`${name.toLowerCase().replaceAll(' ','.')}@medicare.local`
    db.prepare('INSERT OR IGNORE INTO doctors(id,name,email,specialty,qualification,experience_years,consultation_fee,department_id) VALUES(?,?,?,?,?,?,?,?)').run(id(),`Dr. ${name}`,doctorEmail,specialty,'MBBS, MD',8,800,departmentId)
  }
  const demoPatients=[
    'Aarav Sharma','Ananya Rao','Rohan Mehta','Priya Nair','Rahul Verma','Sneha Reddy','Karthik Kumar','Divya Shetty','Arjun Patel','Meera Iyer',
    'Ishaan Gupta','Kavya Menon','Aditya Joshi','Nisha Kapoor','Vivek Das','Tara Krishnan','Kabir Malhotra','Pooja Kulkarni','Dev Shah','Aditi Bhat',
    'Neil Fernandes','Riya Chawla','Samar Banerjee','Ira Desai','Manav Pillai','Sana Qureshi','Om Prakash','Leela Thomas','Yash Sinha','Mira Bose',
  ]
  const diagnoses=['Hypertension review','Annual wellness visit','Seasonal allergy','Routine follow-up','Migraine review','Joint pain assessment','Preventive screening','Skin consultation']
  const bloodGroups=['O+','A+','B+','AB+','O-','A-']
  const patientIds=[]
  const doctorsInDb=db.prepare('SELECT id,specialty FROM doctors ORDER BY email').all()
  const departmentsInDb=db.prepare('SELECT id,name FROM departments').all()
  const patientInsert=db.prepare(`INSERT OR IGNORE INTO patients(id,patient_number,uhid,first_name,last_name,date_of_birth,gender,blood_group,phone,email,address,emergency_name,emergency_phone,allergies,medical_history,doctor_id,department_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for(let i=0;i<demoPatients.length;i++){
    const fullName=demoPatients[i],[firstName,...rest]=fullName.split(' '),lastName=rest.join(' ')
    const patientNumber=`PT-DEMO-${String(i+1).padStart(4,'0')}`
    const doctor=doctorsInDb[i%doctorsInDb.length]
    const department=departmentsInDb.find(d=>d.name===doctor.specialty)
    const birthYear=1980+((i*7)%35)
    patientInsert.run(id(),patientNumber,`MC-DEMO-2026-${String(i+1).padStart(4,'0')}`,firstName,lastName,`${birthYear}-06-15`,i%2?'Female':'Male',bloodGroups[i%bloodGroups.length],`+91 90000${String(10000+i).slice(-5)}`,`patient${String(i+1).padStart(2,'0')}@example.test`,`${12+i} Lakeview Road, Bengaluru`,['Ravi','Nandini','Suresh','Lakshmi'][i%4],`+91 90000${String(50000+i).slice(-5)}`,i%5===0?'Pollen':i%7===0?'Penicillin':'None recorded',diagnoses[i%diagnoses.length],doctor.id,department?.id||null)
    const stored=db.prepare('SELECT id FROM patients WHERE patient_number=?').get(patientNumber)
    patientIds.push(stored.id)
  }
  const apptInsert=db.prepare('INSERT OR IGNORE INTO appointments(id,appointment_number,patient_id,doctor_id,department_id,starts_at,ends_at,type,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?)')
  for(let i=0;i<96;i++){
    const doctor=doctorsInDb[i%doctorsInDb.length]
    const department=departmentsInDb.find(d=>d.name===doctor.specialty)
    const dayOffset=Math.floor(i/doctorsInDb.length)-5
    const starts=new Date();starts.setDate(starts.getDate()+dayOffset);starts.setHours(9+(i%doctorsInDb.length),0,0,0)
    const ends=new Date(starts.getTime()+30*60000)
    const status=dayOffset>0?'SCHEDULED':dayOffset===0?['CHECKED_IN','SCHEDULED','IN_CONSULTATION','SCHEDULED','COMPLETED','SCHEDULED','CHECKED_IN','SCHEDULED'][i%8]:['COMPLETED','COMPLETED','COMPLETED','SCHEDULED','CANCELLED','MISSED'][i%6]
    apptInsert.run(id(),`APT-DEMO-${String(i+1).padStart(4,'0')}`,patientIds[(i*7)%patientIds.length],doctor.id,department.id,starts.toISOString(),ends.toISOString(),i%5===0?'FIRST_VISIT':i%3===0?'FOLLOW_UP':'CONSULTATION',status,'Fictional development seed appointment')
  }
  const medicineRows=[
    ['Amoxicillin 500mg','Antibiotic',86,20],['Metformin 500mg','Antidiabetic',124,30],['Cetirizine 10mg','Antihistamine',18,25],['Atorvastatin 10mg','Cardiovascular',74,20],['Omeprazole 20mg','Gastrointestinal',96,25],['Paracetamol 650mg','Analgesic',12,40],['Amlodipine 5mg','Cardiovascular',54,20],['Vitamin D3 60K','Supplement',68,15],['Azithromycin 500mg','Antibiotic',43,20],['Pantoprazole 40mg','Gastrointestinal',92,25],['Losartan 50mg','Cardiovascular',61,20],['Montelukast 10mg','Respiratory',38,20],['Ibuprofen 400mg','Analgesic',10,25],['Calcium + D3','Supplement',81,20],['Levothyroxine 50mcg','Endocrine',46,20],['Salbutamol inhaler','Respiratory',28,12],['Diclofenac gel','Analgesic',36,18],['ORS sachet','Rehydration',120,40],['Folic acid 5mg','Supplement',64,20],['Clotrimazole cream','Antifungal',8,15],
  ]
  const medicineInsert=db.prepare('INSERT OR IGNORE INTO medicines(id,name,category,minimum_stock) VALUES(?,?,?,?)')
  const batchInsert=db.prepare('INSERT OR IGNORE INTO medicine_batches(id,medicine_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES(?,?,?,?,?,?,?)')
  const stockInsert=db.prepare('INSERT OR IGNORE INTO stock_transactions(id,medicine_id,batch_id,quantity,reason) VALUES(?,?,?,?,?)')
  for(let i=0;i<medicineRows.length;i++){
    const [name,category,quantity,minimum]=medicineRows[i]
    if(!db.prepare('SELECT id FROM medicines WHERE name=?').get(name))medicineInsert.run(id(),name,category,minimum)
    const medicine=db.prepare('SELECT id FROM medicines WHERE name=?').get(name)
    const batchId=id(),batchNumber=`DEMO-B-${String(420+i).padStart(4,'0')}`
    const expiry=new Date(Date.now()+((i%8)+1)*30*86400000).toISOString().slice(0,10)
    batchInsert.run(batchId,medicine.id,batchNumber,expiry,quantity,25+i*3,48+i*9)
    const savedBatch=db.prepare('SELECT id,quantity FROM medicine_batches WHERE medicine_id=? AND batch_number=?').get(medicine.id,batchNumber)
    if(savedBatch?.quantity===quantity&&!db.prepare("SELECT id FROM stock_transactions WHERE batch_id=? AND reason='DEMO_INITIAL_STOCK'").get(savedBatch.id))stockInsert.run(id(),medicine.id,savedBatch.id,quantity,'DEMO_INITIAL_STOCK')
  }
  const labOrderInsert=db.prepare('INSERT OR IGNORE INTO lab_orders(id,patient_id,status,created_at) VALUES(?,?,?,?)')
  const labItemInsert=db.prepare('INSERT INTO lab_order_items(id,lab_order_id,test_name,category,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET test_name=excluded.test_name,category=excluded.category,status=excluded.status')
  const labResultInsert=db.prepare('INSERT OR IGNORE INTO lab_results(id,item_id,value,unit,reference_range,verified_at,published_at) VALUES(?,?,?,?,?,?,?)')
  const labTests=[
    {name:'Complete blood count',category:'Hematology',value:'Within reference interval',unit:null},
    {name:'Blood glucose',category:'Biochemistry',value:'96',unit:'mg/dL'},
    {name:'Lipid profile',category:'Biochemistry',value:'172',unit:'mg/dL'},
    {name:'Thyroid function',category:'Endocrinology',value:'2.4',unit:'mIU/L'},
    {name:'Liver function',category:'Biochemistry',value:'Within reference interval',unit:null},
    {name:'Urine routine examination',category:'Urinalysis',value:'Within reference interval',unit:null},
    {name:'Viral antibody screen',category:'Serology',value:'Non-reactive',unit:null},
    {name:'Blood culture',category:'Microbiology',value:'No growth',unit:null},
  ]
  for(let i=0;i<15;i++){
    const orderId=`LAB-DEMO-${String(i+1).padStart(4,'0')}`
    const status=i===0?'PROCESSING':i<4?'ORDERED':i<10?'COMPLETED':'VERIFIED'
    labOrderInsert.run(orderId,patientIds[i],status,new Date(Date.now()-i*86400000).toISOString())
    const itemId=`${orderId}-01`,test=labTests[i%labTests.length]
    labItemInsert.run(itemId,orderId,test.name,test.category,status)
    if(['COMPLETED','VERIFIED'].includes(status))labResultInsert.run(id(),itemId,test.value,test.unit,'Fictional demo reference',status==='VERIFIED'?new Date().toISOString():null,status==='VERIFIED'?new Date().toISOString():null)
  }
  const invoiceInsert=db.prepare('INSERT INTO invoices(id,invoice_number,patient_id,status,created_at) VALUES(?,?,?,?,?) ON CONFLICT(invoice_number) DO UPDATE SET status=excluded.status')
  const invoiceItemInsert=db.prepare('INSERT OR IGNORE INTO invoice_items(id,invoice_id,description,quantity,unit_price,discount,tax) VALUES(?,?,?,?,?,?,?)')
  const paymentInsert=db.prepare('INSERT OR IGNORE INTO payments(id,invoice_id,amount,method,reference,created_at) VALUES(?,?,?,?,?,?)')
  for(let i=0;i<20;i++){
    const invoiceId=`INV-DEMO-${String(i+1).padStart(4,'0')}`
    const total=1250+i*90
    const paid=i%4===0?Math.floor(total/2):i%4===1?0:total
    const invoiceStatus=paid===0?'PENDING':paid<total?'PARTIALLY_PAID':'PAID'
    invoiceInsert.run(invoiceId,invoiceId,patientIds[i],invoiceStatus,new Date(Date.now()-i*86400000).toISOString())
    invoiceItemInsert.run(`${invoiceId}-ITEM-01`,invoiceId,i%2?'Consultation and diagnostics':'Consultation',1,total,0,0)
    if(paid)paymentInsert.run(`${invoiceId}-PAY-01`,invoiceId,paid,['CASH','UPI','CARD'][i%3],`DEMO-REF-${i+1}`,new Date(Date.now()-i*86400000).toISOString())
  }
  const vitalInsert=db.prepare('INSERT OR IGNORE INTO vitals(id,patient_id,entered_by_id,systolic,diastolic,heart_rate,oxygen,temperature,weight,height,bmi,notes,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const observations=db.prepare('SELECT id FROM users WHERE email=?').get(email)
  for(let i=0;i<patientIds.length;i++){
    const height=150+(i%35),weight=52+(i%25)
    vitalInsert.run(`VITAL-DEMO-${String(i+1).padStart(4,'0')}`,patientIds[i],observations.id,112+(i%25),70+(i%16),66+(i%25),96+(i%4),36.4+(i%6)*0.1,weight,height,Number((weight/((height/100)**2)).toFixed(1)),'Fictional demo observation',new Date(Date.now()-i*86400000).toISOString())
    for(let reading=0;reading<8;reading++){
      const measuredAt=new Date();measuredAt.setUTCDate(1);measuredAt.setUTCMonth(measuredAt.getUTCMonth()-7+reading);measuredAt.setUTCDate(8+((i+reading*3)%18));measuredAt.setUTCHours(10,0,0,0)
      const measuredWeight=52+((i*2+reading*2)%25)-reading*0.2
      const systolic=112+((i*7+reading*3)%25),diastolic=70+((i*3+reading*2)%16)
      vitalInsert.run(`VITAL-DEMO-${String(i+1).padStart(4,'0')}-${String(reading+1).padStart(2,'0')}`,patientIds[i],observations.id,systolic,diastolic,66+((i*5+reading*5)%25),96+((i+reading)%4),36.4+((i+reading)%6)*0.1,measuredWeight,height,Number((measuredWeight/((height/100)**2)).toFixed(1)),'Fictional demo observation',measuredAt.toISOString())
    }
  }
  // Larger, repeatable development dataset. Every generated row uses DEMO identifiers.
  db.exec('BEGIN IMMEDIATE')
  try {
  const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const dateOffset=(key,days)=>{const d=new Date(`${key}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
  const localTimestamp=(key,hour=10,minute=0)=>new Date(`${key}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+05:30`).toISOString()
  const demoFirst=['Aarav','Aanya','Advait','Aditi','Anika','Arjun','Avni','Dev','Diya','Ishaan','Ira','Kabir','Kavya','Kiara','Meera','Mira','Neil','Nisha','Om','Pari','Riya','Rohan','Sana','Tara','Vikram','Yash']
  const demoLast=['Sharma','Rao','Iyer','Menon','Patel','Nair','Reddy','Kapoor','Joshi','Das','Bose','Kulkarni','Pillai','Thomas','Verma','Bhat']
  const specialtyNames=['Cardiology','Neurology','Pediatrics','Orthopedics','Dermatology','General Medicine','Gynecology','ENT','Oncology','Ophthalmology','Urology','Psychiatry','Pulmonology','Gastroenterology','Nephrology','Endocrinology']
  const departmentInsert=db.prepare('INSERT OR IGNORE INTO departments(id,name,description) VALUES(?,?,?)')
  for(const specialty of specialtyNames)departmentInsert.run(`DEMO-DEPT-${specialty.toUpperCase().replaceAll(' ','-')}`,specialty,`DEMO DATA · ${specialty} department`)
  const deptByName=new Map(db.prepare('SELECT id,name FROM departments').all().map(row=>[row.name,row.id]))
  const doctorInsert=db.prepare('INSERT OR IGNORE INTO doctors(id,name,email,phone,specialty,qualification,experience_years,consultation_fee,department_id,active,availability_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  for(let i=1;i<=92;i++){
    const specialty=specialtyNames[(i*7)%specialtyNames.length],n=String(i).padStart(3,'0'),onLeave=[9,26,43,60,77].includes(i),inactive=[90,91].includes(i)
    doctorInsert.run(`DEMO-DOCTOR-${n}`,`Dr. Demo ${demoFirst[i%demoFirst.length]} ${demoLast[(i*3)%demoLast.length]} ${n}`,`demo.doctor.${n}@medicare.local`,`+91 800${String(i).padStart(7,'0')}`,specialty,'MBBS, MD',2+(i*7)%28,500+(i*137)%2500,deptByName.get(specialty),inactive?0:1,onLeave?'ON_LEAVE':inactive?'UNAVAILABLE':'AVAILABLE')
  }
  const activeDoctors=db.prepare("SELECT id,specialty,department_id FROM doctors WHERE active=1 AND availability_status='AVAILABLE' ORDER BY id").all()
  const allDepartments=db.prepare('SELECT id,name FROM departments WHERE active=1 ORDER BY name').all()
  const patientInsertLarge=db.prepare(`INSERT OR IGNORE INTO patients(id,patient_number,uhid,first_name,last_name,date_of_birth,gender,blood_group,phone,email,address,emergency_name,emergency_phone,allergies,medical_history,status,doctor_id,department_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const scalePatientIds=[],scalePatientDates=[]
  let patientSequence=0
  for(let day=-364;day<=0;day++){
    const date=dateOffset(localToday,day),dailyCount=55+((Math.abs(day)*37+11)%46)
    for(let j=0;j<dailyCount;j++){
      patientSequence++
      const dateCode=date.replaceAll('-',''),seq=String(j+1).padStart(3,'0'),key=`${dateCode}-${seq}`
      const doctor=activeDoctors[(patientSequence*13)%activeDoctors.length],departmentId=doctor.department_id
      const year=1940+((patientSequence*19)%66),month=1+((patientSequence*7)%12),birthDay=1+((patientSequence*11)%27)
      const createdAt=localTimestamp(date,8+(j%10),((j*7)%4)*15)
      const patientId=`DEMO-PAT-${key}`
      patientInsertLarge.run(patientId,`PT-DEMO-SCALE-${key}`,`MC-DEMO-SCALE-${key}`,demoFirst[(patientSequence*5)%demoFirst.length],demoLast[(patientSequence*11)%demoLast.length],`${year}-${String(month).padStart(2,'0')}-${String(birthDay).padStart(2,'0')}`,['Female','Male','Non-binary'][patientSequence%3],['O+','A+','B+','AB+','O-','A-','B-'][patientSequence%7],`+91 7${String(100000000+patientSequence).slice(-9)}`,`demo.patient.${key}@example.test`,`${10+(patientSequence%990)} Demo Park, Bengaluru`,demoFirst[(patientSequence+3)%demoFirst.length],`+91 6${String(200000000+patientSequence).slice(-9)}`,patientSequence%9===0?'DEMO DATA · pollen':patientSequence%13===0?'DEMO DATA · penicillin':'None recorded · DEMO DATA',`Fictional demo history ${1+(patientSequence%18)}`,patientSequence%25===0?'ARCHIVED':'ACTIVE',doctor.id,departmentId,createdAt,createdAt)
      scalePatientIds.push(patientId);scalePatientDates.push(date)
    }
  }
  // A small, deterministic schedule is attached to available demo doctors.
  const scheduleInsert=db.prepare('INSERT OR IGNORE INTO doctor_schedules(id,doctor_id,day_of_week,start_time,end_time,slot_minutes,active) VALUES(?,?,?,?,?,?,1)')
  for(let i=0;i<Math.min(90,activeDoctors.length);i++)for(const day of [1+(i%5),1+((i+2)%5)])scheduleInsert.run(`DEMO-SCHEDULE-${String(i+1).padStart(3,'0')}-${day}`,activeDoctors[i].id,day,'09:00','16:00',30)
  const appointmentInsertLarge=db.prepare('INSERT OR IGNORE INTO appointments(id,appointment_number,patient_id,doctor_id,department_id,starts_at,ends_at,type,status,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const consultationInsert=db.prepare('INSERT OR IGNORE INTO consultations(id,patient_id,doctor_id,appointment_id,diagnosis,notes,created_at) VALUES(?,?,?,?,?,?,?)')
  const returningPatientPool=scalePatientIds.slice(0,1800)
  const diagnosisList=['Routine follow-up','Blood pressure review','Preventive health visit','Seasonal allergy assessment','Joint pain review','Metabolic health check','Headache follow-up','Annual wellness consultation']
  const appointmentCount=4000,completedAppointments=[]
  for(let i=1;i<=appointmentCount;i++){
    const doctor=activeDoctors[(i*17)%activeDoctors.length],patientId=returningPatientPool[(i*37)%returningPatientPool.length]
    let status,day
    if(i<=2900){status='COMPLETED';const ageDays=Number(localToday.replaceAll('-',''))?Math.min(350,Math.max(2,Math.floor((new Date(`${localToday}T00:00:00Z`).getTime()-new Date(`${scalePatientDates[(i*37)%returningPatientPool.length]}T00:00:00Z`).getTime())/86400000)-1)):180;day=-1-(i*13)%ageDays}
    else if(i<=3300){status='SCHEDULED';day=1+(i*7)%30}
    else if(i<=3800){status='CANCELLED';day=-2-(i*11)%350}
    else if(i<=4000){status='MISSED';day=-2-(i*5)%350}
    const date=dateOffset(localToday,day),hour=8+(i%11),start=localTimestamp(date,hour,(i%4)*15),end=new Date(new Date(start).getTime()+(i%3===0?60:30)*60000).toISOString(),appointmentId=`DEMO-APPT-${String(i).padStart(5,'0')}`
    appointmentInsertLarge.run(appointmentId,`APT-DEMO-SCALE-${String(i).padStart(5,'0')}`,patientId,doctor.id,doctor.department_id,start,end,['CONSULTATION','FOLLOW_UP','FIRST_VISIT'][i%3],status,'DEMO DATA · generated appointment',start)
    if(status==='COMPLETED'){
      completedAppointments.push({appointmentId,patientId,doctor,start})
      consultationInsert.run(`DEMO-CONSULT-${String(i).padStart(5,'0')}`,patientId,doctor.id,appointmentId,diagnosisList[i%diagnosisList.length],'Fictional development encounter · DEMO DATA',start)
    }
  }
  const medicineCategories=['Antibiotic','Analgesic','Cardiovascular','Antidiabetic','Gastrointestinal','Antihistamine','Respiratory','Supplement','Endocrine','Dermatology','Antifungal','Antiviral','Rehydration','Neurology','Ophthalmology']
  const medicineBases=['Amoxicillin','Paracetamol','Metformin','Cetirizine','Atorvastatin','Omeprazole','Amlodipine','Vitamin D','Azithromycin','Pantoprazole','Losartan','Montelukast','Ibuprofen','Calcium','Levothyroxine','Salbutamol','Diclofenac','Folic acid','Clotrimazole','Aspirin']
  const strengths=['10 mg','25 mg','50 mg','100 mg','250 mg','500 mg','650 mg','1 g','5 ml','20 ml']
  const medicineInsertLarge=db.prepare('INSERT OR IGNORE INTO medicines(id,name,category,minimum_stock,active) VALUES(?,?,?,?,1)')
  const batchInsertLarge=db.prepare('INSERT OR IGNORE INTO medicine_batches(id,medicine_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES(?,?,?,?,?,?,?)')
  const stockInsertLarge=db.prepare('INSERT OR IGNORE INTO stock_transactions(id,medicine_id,batch_id,quantity,reason,created_at) VALUES(?,?,?,?,?,?)')
  const supplierInsert=db.prepare('INSERT OR IGNORE INTO suppliers(id,name,phone,email) VALUES(?,?,?,?)')
  for(let i=1;i<=25;i++)supplierInsert.run(`DEMO-SUPPLIER-${String(i).padStart(3,'0')}`,`Demo Medical Supplier ${String(i).padStart(2,'0')}`,`+91 880${String(i).padStart(7,'0')}`,`supplier${i}@demo.medicare.local`)
  const supplierIds=db.prepare("SELECT id FROM suppliers WHERE id LIKE 'DEMO-SUPPLIER-%' ORDER BY id").all().map(row=>row.id)
  const purchaseOrderInsert=db.prepare('INSERT OR IGNORE INTO purchase_orders(id,supplier_id,status,created_at) VALUES(?,?,?,?)')
  const scaleBatches=[]
  for(let i=1;i<=500;i++){
    const n=String(i).padStart(4,'0'),category=medicineCategories[(i*7)%medicineCategories.length],name=`Demo ${medicineBases[i%medicineBases.length]} ${strengths[(i*3)%strengths.length]} ${n}`
    const medicineId=`DEMO-MED-${n}`
    medicineInsertLarge.run(medicineId,name,category,10+(i%45))
    for(let lot=1;lot<=2;lot++){
      const batchNumber=`DEMO-BATCH-${n}-${lot}`,batchId=`DEMO-BATCH-ID-${n}-${lot}`,quantity=140+(i*lot)%160,purchasePrice=20+(i*17)%800,sellingPrice=purchasePrice+10+(i*11)%250
      const expiry=dateOffset(localToday,45+((i*lot*19)%700)),receivedAt=localTimestamp(dateOffset(localToday,-((i*lot*29)%350)),9)
      batchInsertLarge.run(batchId,medicineId,batchNumber,expiry,quantity,purchasePrice,sellingPrice)
      stockInsertLarge.run(`DEMO-STOCK-RECEIPT-${n}-${lot}`,medicineId,batchId,quantity,'DEMO DATA · purchase receipt',receivedAt)
      scaleBatches.push({batchId,medicineId,quantity})
    }
    if(i<=150)purchaseOrderInsert.run(`DEMO-PURCHASE-ORDER-${String(i).padStart(4,'0')}`,supplierIds[i%supplierIds.length],'RECEIVED',localTimestamp(dateOffset(localToday,-((i*19)%350)),11))
  }
  const medicineIds=db.prepare("SELECT id FROM medicines WHERE id LIKE 'DEMO-MED-%' ORDER BY id").all().map(row=>row.id)
  const labTests=[
    ['Complete blood count','Hematology','Within fictional reference range','cells/µL'],['Blood glucose','Biochemistry','96','mg/dL'],['Lipid profile','Biochemistry','172','mg/dL'],['Thyroid function','Endocrinology','2.4','mIU/L'],['Liver function panel','Biochemistry','Within fictional reference range',null],['Urine routine examination','Urinalysis','Within fictional reference range',null],['Viral antibody screen','Serology','Non-reactive',null],['Blood culture','Microbiology','No growth',null],['Renal function panel','Biochemistry','Within fictional reference range',null],['Peripheral smear','Pathology','Within fictional reference range',null],
  ]
  const labOrderLarge=db.prepare('INSERT OR IGNORE INTO lab_orders(id,patient_id,status,created_at) VALUES(?,?,?,?)')
  const labItemLarge=db.prepare('INSERT INTO lab_order_items(id,lab_order_id,test_name,category,status,technician_id,sample_collected_at,processing_started_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET test_name=excluded.test_name,category=excluded.category,status=excluded.status,sample_collected_at=excluded.sample_collected_at,processing_started_at=excluded.processing_started_at')
  const labResultLarge=db.prepare('INSERT OR IGNORE INTO lab_results(id,item_id,value,unit,reference_range,verified_at,published_at,abnormal) VALUES(?,?,?,?,?,?,?,?)')
  const labStatuses=index=>index<6100?'COMPLETED':index<6900?'PROCESSING':index<7800?'VERIFIED':index<8500?'ORDERED':'SAMPLE_COLLECTED'
  const labOrderCount=4500,labPatientPool=scalePatientIds.slice(0,2500)
  for(let order=1;order<=labOrderCount;order++){
    const firstIndex=(order-1)*2,orderId=`DEMO-LAB-ORDER-${String(order).padStart(5,'0')}`,patientId=labPatientPool[(order*23)%labPatientPool.length],ageDays=(order*17)%300,date=dateOffset(localToday,-ageDays),createdAt=localTimestamp(date,7+(order%12),(order%4)*15),statuses=[labStatuses(firstIndex),labStatuses(firstIndex+1)]
    const orderStatus=statuses.includes('PROCESSING')?'PROCESSING':statuses.includes('SAMPLE_COLLECTED')?'SAMPLE_COLLECTED':statuses.includes('ORDERED')?'ORDERED':statuses.includes('COMPLETED')?'COMPLETED':'VERIFIED'
    labOrderLarge.run(orderId,patientId,orderStatus,createdAt)
    for(let slot=0;slot<2;slot++){
      const itemIndex=firstIndex+slot,test=labTests[(itemIndex*7)%labTests.length],status=statuses[slot],itemId=`DEMO-LAB-ITEM-${String(itemIndex+1).padStart(5,'0')}`,hasResult=['COMPLETED','VERIFIED'].includes(status),abnormal=hasResult&&itemIndex%11===0?1:0,verifiedAt=status==='VERIFIED'?localTimestamp(dateOffset(date,ageDays>1?1:0),20):null
      const collectedAt=status==='ORDERED'?null:new Date(Date.parse(createdAt)+60*60*1000).toISOString(),processingAt=['PROCESSING','COMPLETED','VERIFIED'].includes(status)?new Date(Date.parse(collectedAt)+60*60*1000).toISOString():null
      labItemLarge.run(itemId,orderId,test[0],test[1],status,null,collectedAt,processingAt)
      if(hasResult)labResultLarge.run(`DEMO-LAB-RESULT-${String(itemIndex+1).padStart(5,'0')}`,itemId,abnormal?'Outside fictional demo range':test[2],test[3],abnormal?'DEMO DATA · outside fictional reference range':'DEMO DATA · fictional reference interval',verifiedAt,verifiedAt,abnormal)
    }
  }
  // Five thousand recorded dispense transactions, with batch balances reconciled once per batch.
  for(let i=1;i<=5000;i++){
    const batch=scaleBatches[(i*37)%scaleBatches.length],n=String(i).padStart(5,'0'),units=1+(i%3===0?2:i%5===0?1:0),date=dateOffset(localToday,-((i*23)%365)),createdAt=localTimestamp(date,9+(i%10),(i%4)*15)
    stockInsertLarge.run(`DEMO-SALE-${n}`,batch.medicineId,batch.batchId,-units,'DEMO DATA · DISPENSE SALE',createdAt)
  }
  const saleUnitsByBatch=db.prepare("SELECT batch_id,SUM(-quantity) sold FROM stock_transactions WHERE reason='DEMO DATA · DISPENSE SALE' GROUP BY batch_id").all()
  const reconcileBatch=db.prepare('UPDATE medicine_batches SET quantity=? WHERE id=?')
  for(const row of saleUnitsByBatch){const initial=scaleBatches.find(batch=>batch.batchId===row.batch_id)?.quantity||0;reconcileBatch.run(Math.max(0,initial-Number(row.sold)),row.batch_id)}
  const invoiceInsertLarge=db.prepare('INSERT OR IGNORE INTO invoices(id,invoice_number,patient_id,status,created_at,due_date) VALUES(?,?,?,?,?,?)')
  const invoiceItemLarge=db.prepare('INSERT OR IGNORE INTO invoice_items(id,invoice_id,description,quantity,unit_price,discount,tax) VALUES(?,?,?,?,?,?,?)')
  const paymentInsertLarge=db.prepare('INSERT OR IGNORE INTO payments(id,invoice_id,amount,method,reference,created_at) VALUES(?,?,?,?,?,?)')
  const invoicePatientPool=scalePatientIds.slice(0,1500)
  for(let i=1;i<=4500;i++){
    const n=String(i).padStart(5,'0'),patientId=invoicePatientPool[(i*31)%invoicePatientPool.length],overdue=i>=3201&&i<=3400,daysAgo=overdue?90+(i%210):i<=3200?((i*19)%320):i<=4100?((i*7)%60):((i*13)%320),createdDate=dateOffset(localToday,-daysAgo),createdAt=localTimestamp(createdDate,12),dueDate=dateOffset(createdDate,30),status=i<=3200?'PAID':i<=4100?'PENDING':'PARTIALLY_PAID',invoiceId=`DEMO-INVOICE-${n}`,invoiceNumber=`INV-DEMO-SCALE-${n}`
    const consultation=550+(i*83)%2450,lab=150+(i*47)%1350,pharmacy=100+(i*61)%900
    invoiceInsertLarge.run(invoiceId,invoiceNumber,patientId,status,createdAt,dueDate)
    invoiceItemLarge.run(`${invoiceId}-CONSULT`,invoiceId,'DEMO DATA · consultation charge',1,consultation,0,0)
    invoiceItemLarge.run(`${invoiceId}-LAB`,invoiceId,'DEMO DATA · laboratory charge',1,lab,0,0)
    if(i%3===0)invoiceItemLarge.run(`${invoiceId}-PHARMACY`,invoiceId,'DEMO DATA · pharmacy charge',1,pharmacy,0,0)
    const total=consultation+lab+(i%3===0?pharmacy:0),paid=status==='PAID'?total:status==='PARTIALLY_PAID'?Math.max(1,Math.floor(total/2)):0
    if(paid)paymentInsertLarge.run(`${invoiceId}-PAYMENT`,invoiceId,paid,['CASH','CARD','UPI','BANK_TRANSFER'][i%4],`DEMO-PAY-${n}`,localTimestamp(dateOffset(createdDate,1),13))
  }
  const prescriptionInsert=db.prepare('INSERT INTO prescriptions(id,patient_id,doctor_id,authorized_at,consultation_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET consultation_id=excluded.consultation_id')
  const prescriptionItemInsert=db.prepare('INSERT OR IGNORE INTO prescription_items(id,prescription_id,medicine_id,dosage,duration,quantity) VALUES(?,?,?,?,?,?)')
  for(let i=0;i<2000;i++){
    const encounter=completedAppointments[i],prescriptionId=`DEMO-PRESCRIPTION-${String(i+1).padStart(5,'0')}`
    prescriptionInsert.run(prescriptionId,encounter.patientId,encounter.doctor.id,encounter.start,`DEMO-CONSULT-${String(Number(encounter.appointmentId.replace('DEMO-APPT-',''))).padStart(5,'0')}`)
    prescriptionItemInsert.run(`${prescriptionId}-ITEM-01`,prescriptionId,medicineIds[(i*13)%medicineIds.length],'As directed · DEMO DATA','5 days',10+(i%21))
  }
  // Clearly labeled synthetic patient health history for development and demos.
  // Stable IDs and INSERT OR IGNORE make repeated seed runs safe and leave real records untouched.
  const healthPatients=db.prepare("SELECT id,patient_number FROM patients WHERE patient_number LIKE 'PT-DEMO-%' ORDER BY created_at DESC,id DESC LIMIT 300").all()
  const healthRecorder=db.prepare("SELECT id FROM users WHERE active=1 ORDER BY CASE role WHEN 'NURSE' THEN 0 WHEN 'DOCTOR' THEN 1 ELSE 2 END,created_at LIMIT 1").get()
  const healthVitalInsert=db.prepare('INSERT INTO vitals(id,patient_id,entered_by_id,systolic,diastolic,heart_rate,oxygen,temperature,weight,height,bmi,notes,recorded_at,respiratory_rate,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET systolic=excluded.systolic,diastolic=excluded.diastolic,heart_rate=excluded.heart_rate,oxygen=excluded.oxygen,temperature=excluded.temperature,weight=excluded.weight,height=excluded.height,bmi=excluded.bmi,notes=excluded.notes,recorded_at=excluded.recorded_at,respiratory_rate=excluded.respiratory_rate,source=excluded.source')
  const healthLabOrderInsert=db.prepare('INSERT OR IGNORE INTO lab_orders(id,patient_id,status,created_at) VALUES(?,?,?,?)')
  const healthLabItemInsert=db.prepare('INSERT OR IGNORE INTO lab_order_items(id,lab_order_id,test_name,category,status,sample_collected_at,processing_started_at) VALUES(?,?,?,?,?,?,?)')
  const healthLabResultInsert=db.prepare('INSERT OR IGNORE INTO lab_results(id,item_id,value,unit,reference_range,verified_at,published_at,abnormal,recorded_by_id,source,method) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  const healthLabTests=[
    {name:'Blood glucose',category:'Biochemistry',unit:'mg/dL',value:(i,r)=>String(82+((i*7+r*5)%34))},
    {name:'Hemoglobin',category:'Hematology',unit:'g/dL',value:(i,r)=>(12+((i*5+r*3)%42)/10).toFixed(1)},
    {name:'Total cholesterol',category:'Biochemistry',unit:'mg/dL',value:(i,r)=>String(155+((i*11+r*13)%72))},
    {name:'Creatinine',category:'Biochemistry',unit:'mg/dL',value:(i,r)=>(0.65+((i*7+r*3)%46)/100).toFixed(2)},
    {name:'ALT',category:'Liver function',unit:'U/L',value:(i,r)=>String(12+((i*3+r*7)%34))},
    {name:'AST',category:'Liver function',unit:'U/L',value:(i,r)=>String(14+((i*5+r*9)%30))},
    {name:'Thyroid stimulating hormone',category:'Thyroid',unit:'mIU/L',value:(i,r)=>(0.6+((i*3+r*5)%29)/10).toFixed(1)},
  ]
  const healthReadingDays=Array.from({length:25},(_,index)=>Math.round(89*(24-index)/24))
  for(let i=0;i<healthPatients.length;i++){
    const patient=healthPatients[i],height=150+((i*7)%36)
    for(let r=0;r<healthReadingDays.length;r++){
      const daysAgo=healthReadingDays[r],measurementDate=dateOffset(localToday,-daysAgo),recordedAt=localTimestamp(measurementDate,8+((i+r*3)%10),((i*11+r*7)%4)*15)
      const systolic=108+((i*7+r*3)%34),diastolic=66+((i*5+r*2)%20),weight=Number((52+((i*11+r*3)%35)-r*0.025).toFixed(1))
      const heartRate=60+((i*11+r*7)%36),oxygen=95+((i+r)%5),temperature=Number((36.1+((i*2+r*3)%13)/10).toFixed(1)),respiratoryRate=12+((i*3+r*5)%9),bmi=Number((weight/((height/100)**2)).toFixed(1))
      healthVitalInsert.run(`VITAL-DEMO-HEALTH-${patient.id}-${String(r+1).padStart(2,'0')}`,patient.id,healthRecorder.id,systolic,diastolic,heartRate,oxygen,temperature,weight,height,bmi,'DEMO DATA: synthetic historical measurement',recordedAt,respiratoryRate,'DEMO DATA: synthetic')
    }
    for(let t=0;t<healthLabTests.length;t++)for(let r=0;r<3;r++){
      const test=healthLabTests[t],daysAgo=[84,42,0][r],sampleDate=dateOffset(localToday,-daysAgo),sampleAt=localTimestamp(sampleDate,9+(t%5),15*(r%4)),orderId=`DEMO-HEALTH-LAB-${patient.id}-${String(t+1).padStart(2,'0')}-${r+1}`,itemId=`${orderId}-ITEM`
      healthLabOrderInsert.run(orderId,patient.id,'COMPLETED',sampleAt)
      healthLabItemInsert.run(itemId,orderId,test.name,test.category,'COMPLETED',sampleAt,sampleAt)
      healthLabResultInsert.run(`${itemId}-RESULT`,itemId,test.value(i,r),test.unit,'DEMO DATA only; clinical reference range not supplied',null,null,0,healthRecorder.id,'DEMO DATA: synthetic','Synthetic demonstration method')
    }
  }
  const counts=Object.fromEntries(['patients','doctors','appointments','lab_orders','lab_order_items','medicines','medicine_batches','stock_transactions','invoices','payments','consultations','prescriptions'].map(table=>[table,db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]))
  console.info(`DEMO DATA seeded repeatably. Counts: ${JSON.stringify(counts)}. Administrator login: ${email}`)
  db.exec('COMMIT')
  } catch(error) { db.exec('ROLLBACK'); throw error }
} finally { db.close() }
