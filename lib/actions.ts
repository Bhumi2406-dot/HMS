'use server'

import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db, logActivity } from '@/lib/database'
import { getSession, requireRole } from '@/lib/session'
import { appointmentInput, invoiceInput, labOrderInput, labResultInput, medicineInput, patientInput, paymentInput, staffInput, vitalInput } from '@/lib/validation'

const errorResult = (error: string) => ({ ok: false as const, error })
const fields = (formData: FormData) => Object.fromEntries(formData.entries())

function withTransaction<T>(work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}

export async function registerPatient(formData: FormData) {
  const session = await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST'])
  const parsed = patientInput.safeParse(fields(formData))
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message || 'Check the patient details.')
  const input=parsed.data
  try {
    const result=withTransaction(()=>{
      if(input.doctorId){
        const assigned=db.prepare('SELECT id FROM doctors WHERE id=? AND active=1 AND (? IS NULL OR department_id=?)').get(input.doctorId,input.departmentId||null,input.departmentId||null)
        if(!assigned) throw new Error('INVALID_CARE_TEAM')
      }
      const next=Number((db.prepare('SELECT COUNT(*) AS count FROM patients').get() as {count:number}).count)+1
      const id=randomUUID()
      const patientNumber=`PT-${String(next).padStart(6,'0')}`
      const uhid=`MC-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`
      db.prepare(`INSERT INTO patients(id,patient_number,uhid,first_name,last_name,date_of_birth,gender,blood_group,phone,email,address,emergency_name,emergency_phone,allergies,medical_history,doctor_id,department_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,patientNumber,uhid,input.firstName,input.lastName,input.dateOfBirth||null,input.gender,input.bloodGroup||null,input.phone,input.email||null,input.address||null,input.emergencyName||null,input.emergencyPhone||null,input.allergies||null,input.medicalHistory||null,input.doctorId||null,input.departmentId||null)
      logActivity('PATIENT_REGISTERED',session.userId,id)
      return {id,patientNumber,uhid}
    })
    revalidatePath('/')
    return {ok:true as const,patient:result}
  } catch(e) { return errorResult(e instanceof Error&&e.message==='INVALID_CARE_TEAM'?'The selected doctor and department do not match.':'Could not register patient. Check the submitted details and try again.') }
}

export async function updatePatient(id: string, formData: FormData) {
  const session = await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST'])
  const parsed=patientInput.safeParse(fields(formData))
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message || 'Check the patient details.')
  const p=parsed.data
  try {
    db.prepare(`UPDATE patients SET first_name=?,last_name=?,date_of_birth=?,gender=?,blood_group=?,phone=?,email=?,address=?,emergency_name=?,emergency_phone=?,allergies=?,medical_history=?,doctor_id=?,department_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(p.firstName,p.lastName,p.dateOfBirth||null,p.gender,p.bloodGroup||null,p.phone,p.email||null,p.address||null,p.emergencyName||null,p.emergencyPhone||null,p.allergies||null,p.medicalHistory||null,p.doctorId||null,p.departmentId||null,id)
    logActivity('PATIENT_UPDATED',session.userId,id)
    revalidatePath('/')
    return {ok:true as const}
  } catch { return errorResult('Could not update this patient.') }
}

export async function archivePatient(id:string) {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN'])
  try {
    db.prepare("UPDATE patients SET status='ARCHIVED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    logActivity('PATIENT_ARCHIVED',session.userId,id)
    revalidatePath('/')
    return {ok:true as const}
  } catch { return errorResult('Could not archive this patient.') }
}

export async function createAppointment(formData:FormData) {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST'])
  const parsed=appointmentInput.safeParse(fields(formData))
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message || 'Check appointment details.')
  const a=parsed.data
  if(new Date(a.startsAt)<=new Date()) return errorResult('Appointments must be scheduled in the future.')
  try {
    const appointment=withTransaction(()=>{
      const validPatient=db.prepare("SELECT id FROM patients WHERE id=? AND status='ACTIVE'").get(a.patientId)
      const validDoctor=db.prepare("SELECT id FROM doctors WHERE id=? AND department_id=? AND active=1").get(a.doctorId,a.departmentId)
      const validDepartment=db.prepare('SELECT id FROM departments WHERE id=? AND active=1').get(a.departmentId)
      if(!validPatient||!validDoctor||!validDepartment) throw new Error('INVALID_SELECTION')
      const conflict=db.prepare("SELECT id FROM appointments WHERE doctor_id=? AND status!='CANCELLED' AND starts_at < ? AND ends_at > ? LIMIT 1").get(a.doctorId,a.endsAt,a.startsAt)
      if(conflict) throw new Error('SLOT_CONFLICT')
      const id=randomUUID(), appointmentNumber=`APT-${randomUUID().slice(0,8).toUpperCase()}`
      db.prepare('INSERT INTO appointments(id,appointment_number,patient_id,doctor_id,department_id,starts_at,ends_at,type,notes) VALUES(?,?,?,?,?,?,?,?,?)').run(id,appointmentNumber,a.patientId,a.doctorId,a.departmentId,a.startsAt,a.endsAt,a.type,a.notes||null)
      db.prepare('INSERT INTO notifications(id,title,body,type) VALUES(?,?,?,?)').run(randomUUID(),'New appointment',appointmentNumber,'APPOINTMENT')
      logActivity('APPOINTMENT_BOOKED',session.userId,a.patientId)
      return {id,appointmentNumber}
    })
    revalidatePath('/')
    return {ok:true as const,appointment}
  } catch(e) { return errorResult(e instanceof Error&&e.message==='SLOT_CONFLICT'?'That doctor already has an appointment during this time.':e instanceof Error&&e.message==='INVALID_SELECTION'?'Choose an active patient, doctor, and matching department.':'Could not book appointment.') }
}

export async function changeAppointmentStatus(id:string,status:'CHECKED_IN'|'IN_CONSULTATION'|'COMPLETED'|'CANCELLED'|'MISSED') {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST','DOCTOR'])
  try {
    const row=db.prepare('SELECT patient_id,appointment_number FROM appointments WHERE id=?').get(id) as {patient_id:string;appointment_number:string}|undefined
    if(!row) return errorResult('Appointment was not found.')
    if(session.role==='DOCTOR'){
      const owns=db.prepare('SELECT id FROM appointments WHERE id=? AND doctor_id=(SELECT id FROM doctors WHERE user_id=?)').get(id,session.userId)
      if(!owns)return errorResult('You can only update your own appointments.')
    }
    withTransaction(()=>{
      db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status,id)
      db.prepare('INSERT INTO notifications(id,title,body,type) VALUES(?,?,?,?)').run(randomUUID(),`Appointment ${status.toLowerCase().replace('_',' ')}`,row.appointment_number,'APPOINTMENT')
      logActivity(`APPOINTMENT_${status}`,session.userId,row.patient_id)
    })
    revalidatePath('/')
    return {ok:true as const}
  } catch { return errorResult('Could not update appointment status.') }
}

export async function recordVitals(formData:FormData) {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','NURSE'])
  const parsed=vitalInput.safeParse(fields(formData))
  if(!parsed.success) return errorResult(parsed.error.issues[0]?.message||'Check the vital values.')
  const {patientId,height,weight,...v}=parsed.data
  try {
    const hm=height?height/100:null, bmi=hm&&weight?Number((weight/(hm*hm)).toFixed(1)):null
    const id=randomUUID()
    db.prepare('INSERT INTO vitals(id,patient_id,entered_by_id,systolic,diastolic,heart_rate,oxygen,temperature,weight,height,bmi,notes,respiratory_rate,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,patientId,session.userId,v.systolic??null,v.diastolic??null,v.heartRate??null,v.oxygen??null,v.temperature??null,weight??null,height??null,bmi,v.notes||null,v.respiratoryRate??null,'Nursing entry')
    logActivity('VITALS_RECORDED',session.userId,patientId)
    revalidatePath('/')
    return {ok:true as const}
  } catch { return errorResult('Could not record vitals.') }
}

export async function getCurrentStaff() { return getSession() }

const patientReportInput=z.object({patientId:z.string().min(1).max(80),range:z.enum(['7D','30D','3M','6M','12M','ALL','CUSTOM']).default('ALL'),startDate:z.string().date().optional(),endDate:z.string().date().optional()})
export async function getPatientHealthRecord(raw:{patientId:string;range?:'7D'|'30D'|'3M'|'6M'|'12M'|'ALL'|'CUSTOM';startDate?:string;endDate?:string}){
  const parsed=patientReportInput.safeParse(raw);if(!parsed.success)return errorResult('Select a valid patient and date range.')
  let session
  try{session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','DOCTOR','NURSE'])}catch{return errorResult('You do not have permission to view clinical records.')}
  const {patientId,range,startDate,endDate}=parsed.data,today=localDateKey(new Date());let start=startDate||today,end=endDate||today
  if(range==='CUSTOM'&&(!startDate||!endDate))return errorResult('Choose both dates for a custom date range.')
  if(range==='ALL'){start='1900-01-01';end=today}else if(range!=='CUSTOM'){end=today;start=range==='7D'?offsetDate(today,-6):range==='30D'?offsetDate(today,-29):range==='3M'?offsetDate(today,-90):range==='6M'?offsetDate(today,-180):offsetDate(today,-364)}
  if(start>end)return errorResult('Start date must be before end date.')
  const from=toUtcBoundary(start),until=toUtcBoundary(offsetDate(end,1))
  try{
    const patient=db.prepare('SELECT id,doctor_id FROM patients WHERE id=?').get(patientId) as {id:string;doctor_id:string|null}|undefined
    if(!patient)return errorResult('Patient record was not found.')
    if(session.role==='DOCTOR'){const doctor=db.prepare('SELECT id FROM doctors WHERE user_id=?').get(session.userId) as {id:string}|undefined;if(!doctor||patient.doctor_id!==doctor.id)return errorResult('You can only view clinical records for your assigned patients.')}
    const vitals=db.prepare(`SELECT v.*,u.name recorded_by FROM vitals v LEFT JOIN users u ON u.id=v.entered_by_id WHERE v.patient_id=? AND datetime(v.recorded_at)>=datetime(?) AND datetime(v.recorded_at)<datetime(?) ORDER BY v.recorded_at`).all(patientId,from,until)
    const visits=db.prepare(`SELECT a.id,a.starts_at,a.ends_at,a.status,a.type,a.notes,d.name department_name,dr.name doctor_name FROM appointments a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN doctors dr ON dr.id=a.doctor_id WHERE a.patient_id=? AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) ORDER BY a.starts_at`).all(patientId,from,until)
    const appointmentStatus=db.prepare(`SELECT status label,COUNT(*) value FROM appointments WHERE patient_id=? AND datetime(starts_at)>=datetime(?) AND datetime(starts_at)<datetime(?) GROUP BY status ORDER BY value DESC`).all(patientId,from,until)
    const departments=db.prepare(`SELECT COALESCE(d.name,'Unassigned') label,COUNT(*) value FROM appointments a LEFT JOIN departments d ON d.id=a.department_id WHERE a.patient_id=? AND a.status='COMPLETED' AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) GROUP BY d.id ORDER BY value DESC`).all(patientId,from,until)
    const consultations=db.prepare(`SELECT c.*,dr.name doctor_name FROM consultations c LEFT JOIN doctors dr ON dr.id=c.doctor_id WHERE c.patient_id=? AND datetime(c.created_at)>=datetime(?) AND datetime(c.created_at)<datetime(?) ORDER BY c.created_at`).all(patientId,from,until)
    const consultationTrend=db.prepare(`SELECT strftime('%Y-%m',c.created_at,'+5 hours','+30 minutes') label,COUNT(*) value FROM consultations c WHERE c.patient_id=? AND datetime(c.created_at)>=datetime(?) AND datetime(c.created_at)<datetime(?) GROUP BY label ORDER BY label`).all(patientId,from,until)
    const prescriptions=db.prepare(`SELECT pr.id,pr.authorized_at,dr.name doctor_name,m.name medicine_name,pi.dosage,pi.duration,pi.quantity FROM prescriptions pr LEFT JOIN doctors dr ON dr.id=pr.doctor_id LEFT JOIN prescription_items pi ON pi.prescription_id=pr.id LEFT JOIN medicines m ON m.id=pi.medicine_id WHERE pr.patient_id=? AND datetime(pr.authorized_at)>=datetime(?) AND datetime(pr.authorized_at)<datetime(?) ORDER BY pr.authorized_at`).all(patientId,from,until)
    const labs=db.prepare(`SELECT i.id,i.test_name,i.category,i.status,COALESCE(i.sample_collected_at,r.verified_at,l.created_at) test_date,r.value,r.unit,r.reference_range,r.abnormal,r.verified_at,r.source,r.method,result_recorder.name recorded_by,tech.name technician_name FROM lab_orders l JOIN lab_order_items i ON i.lab_order_id=l.id LEFT JOIN lab_results r ON r.item_id=i.id LEFT JOIN users result_recorder ON result_recorder.id=r.recorded_by_id LEFT JOIN users tech ON tech.id=i.technician_id WHERE l.patient_id=? AND datetime(l.created_at)>=datetime(?) AND datetime(l.created_at)<datetime(?) ORDER BY test_date`).all(patientId,from,until)
    const history=db.prepare(`SELECT h.*,u.name recorded_by FROM medical_history h LEFT JOIN users u ON u.id=(SELECT user_id FROM activity_logs x WHERE x.patient_id=h.patient_id AND x.created_at=h.recorded_at ORDER BY x.created_at DESC LIMIT 1) WHERE h.patient_id=? AND datetime(h.recorded_at)>=datetime(?) AND datetime(h.recorded_at)<datetime(?) ORDER BY h.recorded_at`).all(patientId,from,until)
    const immunizations=db.prepare(`SELECT i.*,u.name recorded_by FROM patient_immunizations i LEFT JOIN users u ON u.id=i.recorded_by_id WHERE i.patient_id=? AND datetime(i.administered_at)>=datetime(?) AND datetime(i.administered_at)<datetime(?) ORDER BY i.administered_at`).all(patientId,from,until)
    const procedures=db.prepare(`SELECT p.*,u.name recorded_by FROM patient_procedures p LEFT JOIN users u ON u.id=p.recorded_by_id WHERE p.patient_id=? AND datetime(p.performed_at)>=datetime(?) AND datetime(p.performed_at)<datetime(?) ORDER BY p.performed_at`).all(patientId,from,until)
    const summary=db.prepare(`SELECT COUNT(*) total_visits,SUM(status='COMPLETED') completed_visits FROM appointments WHERE patient_id=? AND datetime(starts_at)>=datetime(?) AND datetime(starts_at)<datetime(?)`).get(patientId,from,until) as {total_visits:number;completed_visits:number|null}
    return {ok:true as const,data:{range:{start,end},vitals:plainRows(vitals),visits:plainRows(visits),appointmentStatus:plainRows(appointmentStatus),departments:plainRows(departments),consultations:plainRows(consultations),consultationTrend:plainRows(consultationTrend),prescriptions:plainRows(prescriptions),labs:plainRows(labs),history:plainRows(history),immunizations:plainRows(immunizations),procedures:plainRows(procedures),summary:{totalVisits:Number(summary.total_visits||0),completedVisits:Number(summary.completed_visits||0),labTests:labs.length}}}
  }catch(error){console.error('Patient health record query failed',error);return errorResult('Could not load this patient health record.')}
}

const doctorProfileInput=z.object({name:z.string().trim().min(2).max(120),specialty:z.string().trim().min(2).max(100),departmentId:z.string().min(1).max(80),email:z.union([z.string().email().max(160),z.literal('')]).optional(),phone:z.string().max(30).optional(),qualification:z.string().max(160).optional(),experienceYears:z.coerce.number().int().min(0).max(80).default(0),consultationFee:z.coerce.number().int().min(0).max(1000000).default(0)})
export async function createDoctor(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN'])
  const parsed=doctorProfileInput.safeParse(fields(formData));if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check the doctor profile.')
  const d=parsed.data
  try{const id=randomUUID();const valid=db.prepare('SELECT id FROM departments WHERE id=? AND active=1').get(d.departmentId);if(!valid)return errorResult('Choose an active department.')
    db.prepare('INSERT INTO doctors(id,name,email,phone,specialty,qualification,experience_years,consultation_fee,department_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id,d.name,d.email||null,d.phone||null,d.specialty,d.qualification||null,d.experienceYears,d.consultationFee,d.departmentId)
    logActivity('DOCTOR_PROFILE_CREATED',session.userId,null,d.name);revalidatePath('/');return {ok:true as const}
  }catch{return errorResult('Could not create the doctor profile. The email may already be in use.')}
}
export async function setDoctorActive(id:string,active:boolean){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN'])
  try{const changed=db.prepare("UPDATE doctors SET active=?,availability_status=? WHERE id=?").run(active?1:0,active?'AVAILABLE':'UNAVAILABLE',id);if(!changed.changes)return errorResult('Doctor profile was not found.');logActivity(active?'DOCTOR_PROFILE_ACTIVATED':'DOCTOR_PROFILE_DEACTIVATED',session.userId,null,id);revalidatePath('/');return {ok:true as const}}
  catch{return errorResult('Could not update doctor availability.')}
}

export async function createStaff(formData:FormData) {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN'])
  const parsed=staffInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check the staff account details.')
  try {
    const {name,email,password,role}=parsed.data
    if(role==='SUPER_ADMIN'&&session.role!=='SUPER_ADMIN')return errorResult('Only a super administrator can create another super administrator.')
    const id=randomUUID(),passwordHash=await bcrypt.hash(password,12)
    const normalizedEmail=email.toLowerCase()
    withTransaction(()=>{
      db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id,name,normalizedEmail,passwordHash,role)
      if(role==='DOCTOR'){
        const result=db.prepare('UPDATE doctors SET user_id=? WHERE email=? COLLATE NOCASE AND user_id IS NULL').run(id,normalizedEmail)
        if(!result.changes)throw new Error('DOCTOR_PROFILE_REQUIRED')
      }
    })
    logActivity('STAFF_ACCOUNT_CREATED',session.userId,null,`${role}:${email.toLowerCase()}`)
    revalidatePath('/')
    return {ok:true as const}
  } catch(e) {return errorResult(e instanceof Error&&e.message==='DOCTOR_PROFILE_REQUIRED'?'A matching unassigned doctor profile must exist for this email.':'Could not create the staff account. Check if the email is already in use.')}
}

export async function setStaffActive(id:string,active:boolean) {
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN'])
  if(id===session.userId&&!active)return errorResult('You cannot deactivate your own account.')
  try {
    db.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0,id)
    logActivity(active?'STAFF_ACCOUNT_ACTIVATED':'STAFF_ACCOUNT_DEACTIVATED',session.userId,null,id)
    revalidatePath('/')
    return {ok:true as const}
  } catch {return errorResult('Could not update the staff account.')}
}

const analyticsInput=z.object({
  module:z.enum(['LABORATORY','PHARMACY','BILLING']),
  range:z.enum(['TODAY','7D','30D','3M','6M','12M','YEAR','CUSTOM']).default('30D'),
  startDate:z.string().date().optional(),endDate:z.string().date().optional(),
  category:z.string().max(80).optional(),status:z.string().max(40).optional(),method:z.enum(['CASH','CARD','UPI','BANK_TRANSFER']).optional(),technicianId:z.string().max(80).optional(),
})
const plainRows=(rows:unknown[])=>rows.map((row)=>({...row as object}))
const localDateKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
const offsetDate=(dateKey:string,days:number)=>{const d=new Date(`${dateKey}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
const toUtcBoundary=(dateKey:string)=>new Date(`${dateKey}T00:00:00+05:30`).toISOString()

export async function getModuleAnalytics(raw:{module:'LABORATORY'|'PHARMACY'|'BILLING';range?:'TODAY'|'7D'|'30D'|'3M'|'6M'|'12M'|'YEAR'|'CUSTOM';startDate?:string;endDate?:string;category?:string;status?:string;method?:'CASH'|'CARD'|'UPI'|'BANK_TRANSFER';technicianId?:string}){
  const parsed=analyticsInput.safeParse(raw)
  if(!parsed.success)return {ok:false as const,error:'Invalid analytics filter.'}
  const input=parsed.data
  try {
    if(input.module==='LABORATORY')await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','DOCTOR','NURSE','LAB_TECHNICIAN'])
    if(input.module==='PHARMACY')await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','PHARMACIST'])
    if(input.module==='BILLING')await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','ACCOUNTANT','RECEPTIONIST'])
  } catch {return {ok:false as const,error:'You do not have access to these analytics.'}}
  const today=localDateKey(new Date())
  let start=input.startDate||today,end=input.endDate||today
  if(input.range!=='CUSTOM'){
    end=today
    if(input.range==='TODAY')start=today
    else if(input.range==='7D')start=offsetDate(today,-6)
    else if(input.range==='30D')start=offsetDate(today,-29)
    else if(input.range==='3M'){const d=new Date(`${today}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-3);start=d.toISOString().slice(0,10)}
    else if(input.range==='6M'){const d=new Date(`${today}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-6);start=d.toISOString().slice(0,10)}
    else if(input.range==='12M')start=offsetDate(today,-364)
    else if(input.range==='YEAR')start=`${today.slice(0,4)}-01-01`
  }
  if(start>end)return {ok:false as const,error:'Start date must be before end date.'}
  const from=toUtcBoundary(start),until=toUtcBoundary(offsetDate(end,1))
  const spanDays=Math.ceil((new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000)+1
  const grain=spanDays<=31?'day':spanDays<=120?'week':'month'
  const periodExpr=grain==='day'?"strftime('%Y-%m-%d',created_at)":grain==='week'?"strftime('%Y-W%W',created_at)":"strftime('%Y-%m',created_at)"
  try {
    if(input.module==='LABORATORY'){
      const params:string[]=[from,until]
      let where='l.created_at>=? AND l.created_at<?'
      if(input.category){where+=' AND i.category=?';params.push(input.category)}
      if(input.status){where+=' AND i.status=?';params.push(input.status)}
      if(input.technicianId){where+=' AND i.technician_id=?';params.push(input.technicianId)}
      const session=await getSession()
      if(session?.role==='DOCTOR'){where+=' AND p.doctor_id=(SELECT id FROM doctors WHERE user_id=?)';params.push(session.userId)}
      const totals=db.prepare(`SELECT COUNT(i.id) total, SUM(CASE WHEN i.status IN ('ORDERED','SAMPLE_COLLECTED','PROCESSING') THEN 1 ELSE 0 END) pending, SUM(CASE WHEN i.status IN ('COMPLETED','VERIFIED') THEN 1 ELSE 0 END) completed, COUNT(DISTINCT l.id) orders FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id WHERE ${where}`).get(...params) as Record<string,number|null>
      const status=db.prepare(`SELECT i.status label,COUNT(*) value FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id WHERE ${where} GROUP BY i.status ORDER BY value DESC`).all(...params)
      const categories=db.prepare(`SELECT i.category label,COUNT(*) value FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id WHERE ${where} GROUP BY i.category ORDER BY value DESC`).all(...params)
      const trend=db.prepare(`SELECT ${periodExpr.replaceAll('created_at','l.created_at')} label,COUNT(i.id) value FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id WHERE ${where} GROUP BY label ORDER BY label`).all(...params)
      const turnaround=db.prepare(`SELECT i.category label,AVG((julianday(r.verified_at)-julianday(l.created_at))*24) value,COUNT(*) samples FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id JOIN lab_results r ON r.item_id=i.id WHERE ${where} AND r.verified_at IS NOT NULL GROUP BY i.category ORDER BY value DESC`).all(...params)
      const turnaroundAverage=db.prepare(`SELECT AVG((julianday(r.verified_at)-julianday(l.created_at))*24) value FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id JOIN lab_results r ON r.item_id=i.id WHERE ${where} AND r.verified_at IS NOT NULL`).get(...params) as {value:number|null}
      const abnormalResults=Number((db.prepare(`SELECT COUNT(*) n FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id JOIN lab_results r ON r.item_id=i.id WHERE ${where} AND r.abnormal=1`).get(...params) as {n:number}).n||0)
      const records=db.prepare(`SELECT i.id,i.test_name,i.category,i.status,l.created_at,p.first_name||' '||p.last_name patient_name,r.value,r.unit,r.reference_range,r.verified_at,r.abnormal FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id LEFT JOIN lab_results r ON r.item_id=i.id WHERE ${where} ORDER BY l.created_at DESC LIMIT 300`).all(...params)
      const options=db.prepare("SELECT DISTINCT category value FROM lab_order_items ORDER BY category").all()
      const technicians=db.prepare("SELECT id,name FROM users WHERE role='LAB_TECHNICIAN' AND active=1 ORDER BY name").all()
      return {ok:true as const,data:{module:input.module,range:{start,end,grain},kpis:{total:Number(totals.total||0),pending:Number(totals.pending||0),completed:Number(totals.completed||0),orders:Number(totals.orders||0),averageVerificationHours:turnaroundAverage.value,abnormalResults,revenue:null},trend:plainRows(trend as unknown[]),status:plainRows(status as unknown[]),categories:plainRows(categories as unknown[]),turnaround:plainRows(turnaround as unknown[]),records:plainRows(records as unknown[]),options:plainRows(options as unknown[]),technicians:plainRows(technicians as unknown[]),untracked:['Sample collection timestamps are not separately recorded.','Laboratory charges are not linked to invoices.']}}
    }
    if(input.module==='PHARMACY'){
      const medicineParams:string[]=[];let medicineWhere='m.active=1'
      if(input.category){medicineWhere+=' AND m.category=?';medicineParams.push(input.category)}
      const stockRows=db.prepare(`SELECT m.id,m.name,m.category,m.minimum_stock,COALESCE(SUM(b.quantity),0) quantity,COALESCE(SUM(CASE WHEN b.expiry_date<date('now') THEN b.quantity ELSE 0 END),0) expired_quantity,COALESCE(SUM(b.quantity*b.purchase_price),0) value,MIN(b.expiry_date) nearest_expiry FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id WHERE ${medicineWhere} GROUP BY m.id ORDER BY m.name`).all(...medicineParams) as Record<string,any>[]
      const visibleStock=stockRows.filter(row=>{const qty=Number(row.quantity),expired=Number(row.expired_quantity);const stockStatus=qty===0?'OUT_OF_STOCK':expired>=qty?'EXPIRED':qty<=Number(row.minimum_stock)?'LOW_STOCK':'AVAILABLE';return !input.status||input.status===stockStatus})
      const summary={totalMedicines:visibleStock.length,stockValue:visibleStock.reduce((sum,row)=>sum+Number(row.value),0),lowStock:visibleStock.filter(r=>Number(r.quantity)>0&&Number(r.quantity)<=Number(r.minimum_stock)&&Number(r.expired_quantity)<Number(r.quantity)).length,outOfStock:visibleStock.filter(r=>Number(r.quantity)===0).length,expired:visibleStock.filter(r=>Number(r.quantity)>0&&Number(r.expired_quantity)>=Number(r.quantity)).length,expiring90:visibleStock.filter(r=>r.nearest_expiry&&r.nearest_expiry>=today&&r.nearest_expiry<=offsetDate(today,90)).length}
      const batchParams:string[]=[from,until];let txWhere='t.created_at>=? AND t.created_at<?'
      if(input.category){txWhere+=' AND m.category=?';batchParams.push(input.category)}
      const salesTrend=db.prepare(`SELECT ${periodExpr.replaceAll('created_at','t.created_at')} label, SUM(CASE WHEN t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%') THEN -t.quantity ELSE 0 END) value FROM stock_transactions t JOIN medicines m ON m.id=t.medicine_id WHERE ${txWhere} GROUP BY label ORDER BY label`).all(...batchParams)
      const topSelling=db.prepare(`SELECT m.name label,SUM(-t.quantity) value,SUM(-t.quantity*b.selling_price) revenue FROM stock_transactions t JOIN medicines m ON m.id=t.medicine_id LEFT JOIN medicine_batches b ON b.id=t.batch_id WHERE ${txWhere} AND t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%') GROUP BY m.id ORDER BY value DESC LIMIT 10`).all(...batchParams)
      const categories=db.prepare(`SELECT m.category label,COUNT(DISTINCT m.id) value FROM medicines m WHERE ${medicineWhere} GROUP BY m.category ORDER BY value DESC`).all(...medicineParams)
      const expiryParams: string[]=[];let expiryWhere='m.active=1'
      if(input.category){expiryWhere+=' AND m.category=?';expiryParams.push(input.category)}
      const expiry=db.prepare(`SELECT CASE WHEN b.expiry_date<date('now') THEN 'Expired' WHEN b.expiry_date<=date('now','+30 days') THEN 'Within 30 days' WHEN b.expiry_date<=date('now','+60 days') THEN '31â€“60 days' WHEN b.expiry_date<=date('now','+90 days') THEN '61â€“90 days' ELSE 'Beyond 90 days' END label,COUNT(DISTINCT b.id) value FROM medicines m JOIN medicine_batches b ON b.medicine_id=m.id WHERE ${expiryWhere} GROUP BY label`).all(...expiryParams)
      const status=[{label:'AVAILABLE',value:stockRows.filter(r=>Number(r.quantity)>Number(r.minimum_stock)&&Number(r.expired_quantity)<Number(r.quantity)).length},{label:'LOW_STOCK',value:stockRows.filter(r=>Number(r.quantity)>0&&Number(r.quantity)<=Number(r.minimum_stock)&&Number(r.expired_quantity)<Number(r.quantity)).length},{label:'OUT_OF_STOCK',value:stockRows.filter(r=>Number(r.quantity)===0).length},{label:'EXPIRED',value:stockRows.filter(r=>Number(r.quantity)>0&&Number(r.expired_quantity)>=Number(r.quantity)).length}].filter(x=>x.value>0)
      const movement=db.prepare(`SELECT ${periodExpr.replaceAll('created_at','t.created_at')} label,SUM(CASE WHEN t.quantity>0 THEN t.quantity ELSE 0 END) received,SUM(CASE WHEN t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%') THEN -t.quantity ELSE 0 END) dispensed,SUM(CASE WHEN t.reason LIKE '%ADJUST%' THEN ABS(t.quantity) ELSE 0 END) adjusted FROM stock_transactions t JOIN medicines m ON m.id=t.medicine_id WHERE ${txWhere} GROUP BY label ORDER BY label`).all(...batchParams)
      const purchasesAndSales=db.prepare(`SELECT strftime('%Y-%m',t.created_at) label,SUM(CASE WHEN t.quantity>0 THEN t.quantity*b.purchase_price ELSE 0 END) purchases,SUM(CASE WHEN t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%') THEN -t.quantity*b.selling_price ELSE 0 END) sales FROM stock_transactions t JOIN medicines m ON m.id=t.medicine_id LEFT JOIN medicine_batches b ON b.id=t.batch_id WHERE ${txWhere} GROUP BY label ORDER BY label`).all(...batchParams)
      const records=visibleStock.map(row=>({...row,stock_status:Number(row.quantity)===0?'OUT_OF_STOCK':Number(row.expired_quantity)>=Number(row.quantity)?'EXPIRED':Number(row.quantity)<=Number(row.minimum_stock)?'LOW_STOCK':'AVAILABLE'})).slice(0,300)
      const options=db.prepare('SELECT DISTINCT category value FROM medicines WHERE active=1 ORDER BY category').all()
      const revenue=Number(db.prepare(`SELECT COALESCE(SUM(-t.quantity*b.selling_price),0) value FROM stock_transactions t JOIN medicine_batches b ON b.id=t.batch_id JOIN medicines m ON m.id=t.medicine_id WHERE ${txWhere} AND t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%')`).get(...batchParams)?.value||0)
      const monthlySales=Number(db.prepare(`SELECT COALESCE(SUM(-t.quantity),0) value FROM stock_transactions t JOIN medicines m ON m.id=t.medicine_id WHERE ${txWhere} AND t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%')`).get(...batchParams)?.value||0)
      return {ok:true as const,data:{module:input.module,range:{start,end,grain},kpis:{...summary,monthlySales,revenue},trend:plainRows(salesTrend as unknown[]),status:plainRows(status as unknown[]),categories:plainRows(categories as unknown[]),expiry:plainRows(expiry as unknown[]),topSelling:plainRows(topSelling as unknown[]),movement:plainRows(movement as unknown[]),purchasesAndSales:plainRows(purchasesAndSales as unknown[]),records,options:plainRows(options as unknown[]),untracked:['No dispensing/sale transactions are recorded yet; sales charts are empty until stock is dispensed.','Supplier purchase orders and purchase expenses are not linked to stock batches.']}}
    }
    const invoiceParams:string[]=[from,until];let invoiceWhere='i.created_at>=? AND i.created_at<?'
    if(input.status){invoiceWhere+=' AND i.status=?';invoiceParams.push(input.status)}
    if(input.method){invoiceWhere+=' AND EXISTS (SELECT 1 FROM payments px WHERE px.invoice_id=i.id AND px.method=?)';invoiceParams.push(input.method)}
    const billingTotals=db.prepare(`SELECT COUNT(*) invoices,COALESCE(SUM((SELECT COALESCE(SUM(quantity*unit_price-discount+tax),0) FROM invoice_items x WHERE x.invoice_id=i.id)),0) billed,COALESCE(SUM((SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) collected FROM invoices i WHERE ${invoiceWhere}`).get(...invoiceParams) as Record<string,number>
    const status=db.prepare(`SELECT i.status label,COUNT(*) value FROM invoices i WHERE ${invoiceWhere} GROUP BY i.status`).all(...invoiceParams)
    const methodParams:string[]=[from,until];let methodWhere='p.created_at>=? AND p.created_at<?'
    if(input.method){methodWhere+=' AND p.method=?';methodParams.push(input.method)}
    if(input.status){methodWhere+=' AND i.status=?';methodParams.push(input.status)}
    const methods=db.prepare(`SELECT p.method label,SUM(p.amount) value FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE ${methodWhere} GROUP BY p.method ORDER BY value DESC`).all(...methodParams)
    const revenueTrend=db.prepare(`SELECT ${grain==='day'?"strftime('%Y-%m-%d',p.created_at)":grain==='week'?"strftime('%Y-W%W',p.created_at)":"strftime('%Y-%m',p.created_at)"} label,SUM(p.amount) value FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE ${methodWhere} GROUP BY label ORDER BY label`).all(...methodParams)
    const invoiceTrend=db.prepare(`SELECT ${periodExpr.replaceAll('created_at','i.created_at')} label,COUNT(*) value FROM invoices i WHERE ${invoiceWhere} GROUP BY label ORDER BY label`).all(...invoiceParams)
    const collection=db.prepare(`SELECT strftime('%Y-%m',i.created_at) label,COALESCE(SUM((SELECT COALESCE(SUM(quantity*unit_price-discount+tax),0) FROM invoice_items x WHERE x.invoice_id=i.id)),0) billed,COALESCE(SUM((SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) collected FROM invoices i WHERE ${invoiceWhere} GROUP BY label ORDER BY label`).all(...invoiceParams)
    const records=db.prepare(`SELECT i.id,i.invoice_number,i.status,i.created_at,p.first_name||' '||p.last_name patient_name,(SELECT COALESCE(SUM(quantity*unit_price-discount+tax),0) FROM invoice_items x WHERE x.invoice_id=i.id) total,(SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=i.id) paid FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE ${invoiceWhere} ORDER BY i.created_at DESC LIMIT 300`).all(...invoiceParams) as Record<string,any>[]
    const totalBilled=Number(billingTotals.billed||0),totalCollected=Number(billingTotals.collected||0),paymentsReceived=Number(db.prepare(`SELECT COALESCE(SUM(amount),0) value FROM payments p WHERE ${methodWhere}`).get(...methodParams)?.value||0)
    const pendingInvoices=Number(db.prepare(`SELECT COUNT(*) value FROM invoices i WHERE ${invoiceWhere} AND i.status IN ('PENDING','PARTIALLY_PAID')`).get(...invoiceParams)?.value||0)
    const options=db.prepare('SELECT DISTINCT method value FROM payments ORDER BY method').all()
    const overdueInvoices=Number(db.prepare(`SELECT COUNT(*) value FROM invoices i WHERE ${invoiceWhere} AND i.status IN ('PENDING','PARTIALLY_PAID') AND i.due_date IS NOT NULL AND i.due_date<date('now','+5 hours','+30 minutes')`).get(...invoiceParams)?.value||0)
    return {ok:true as const,data:{module:input.module,range:{start,end,grain},kpis:{totalInvoices:Number(billingTotals.invoices||0),billed:totalBilled,collected:totalCollected,paymentsReceived, pending:Math.max(0,totalBilled-totalCollected),pendingInvoices,collectionRate:totalBilled?totalCollected/totalBilled*100:0,overdue:overdueInvoices},trend:plainRows(revenueTrend as unknown[]),status:plainRows(status as unknown[]),methods:plainRows(methods as unknown[]),invoiceTrend:plainRows(invoiceTrend as unknown[]),collection:plainRows(collection as unknown[]),records:plainRows(records as unknown[]),options:plainRows(options as unknown[]),untracked:['Overdue invoices are counted by their stored due dates.','Department/service revenue is not categorized on invoice lines.','Expense records are not present; no profit or surplus estimate is shown.']}}
  } catch(e) {console.error('Module analytics query failed',e);return {ok:false as const,error:e instanceof Error?'Could not load analytics for the selected filters.':'Could not load analytics.'}}
}

const coreAnalyticsInput=z.object({page:z.enum(['OVERVIEW','PATIENTS','APPOINTMENTS','DOCTORS','DOCTOR_ANALYTICS']),range:z.enum(['TODAY','YESTERDAY','7D','30D','3M','6M','12M','YEAR','CUSTOM']).default('30D'),startDate:z.string().date().optional(),endDate:z.string().date().optional(),departmentId:z.string().max(80).optional(),doctorId:z.string().max(80).optional(),status:z.string().max(40).optional(),type:z.string().max(40).optional(),ageGroup:z.string().max(20).optional(),gender:z.string().max(20).optional(),bloodGroup:z.string().max(10).optional(),specialty:z.string().max(100).optional(),compareDoctorIds:z.array(z.string().max(80)).max(8).optional()})
const addDate=(key:string,days:number)=>{const d=new Date(`${key}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
const addMonths=(key:string,months:number)=>{const d=new Date(`${key}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10)}

export async function getCoreAnalytics(raw:{page:'OVERVIEW'|'PATIENTS'|'APPOINTMENTS'|'DOCTORS'|'DOCTOR_ANALYTICS';range?:'TODAY'|'YESTERDAY'|'7D'|'30D'|'3M'|'6M'|'12M'|'YEAR'|'CUSTOM';startDate?:string;endDate?:string;departmentId?:string;doctorId?:string;status?:string;type?:string;ageGroup?:string;gender?:string;bloodGroup?:string;specialty?:string;compareDoctorIds?:string[]}){
  const parsed=coreAnalyticsInput.safeParse(raw)
  if(!parsed.success)return {ok:false as const,error:'Invalid analytics filters.'}
  const f=parsed.data
  let session
  try{session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST','DOCTOR','NURSE'])}catch{return {ok:false as const,error:'You do not have access to these analytics.'}}
  const today=localDateKey(new Date());let start=f.startDate||today,end=f.endDate||today
  if(f.range!=='CUSTOM'){
    end=today
    if(f.range==='TODAY')start=today
    else if(f.range==='YESTERDAY'){start=addDate(today,-1);end=start}
    else if(f.range==='7D')start=addDate(today,-6)
    else if(f.range==='30D')start=addDate(today,-29)
    else if(f.range==='3M')start=addMonths(today,-3)
    else if(f.range==='6M')start=addMonths(today,-6)
    else if(f.range==='12M')start=addDate(today,-364)
    else if(f.range==='YEAR')start=`${today.slice(0,4)}-01-01`
  }
  if(start>end)return {ok:false as const,error:'Start date must be before end date.'}
  const from=toUtcBoundary(start),until=toUtcBoundary(addDate(end,1)),days=Math.ceil((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000)+1
  const grain=days<=31?'day':days<=120?'week':'month'
  const period=grain==='day'?"strftime('%Y-%m-%d',X)":grain==='week'?"strftime('%Y-W%W',X)":"strftime('%Y-%m',X)"
  const doctorScope=session.role==='DOCTOR'?db.prepare('SELECT id FROM doctors WHERE user_id=?').get(session.userId) as {id:string}|undefined:undefined
  if(session.role==='DOCTOR'&&!doctorScope)return {ok:false as const,error:'No doctor profile is linked to this account.'}
  const doctorId=session.role==='DOCTOR'?doctorScope!.id:f.doctorId
  const comparisonIds=f.page==='DOCTOR_ANALYTICS'&&session.role!=='DOCTOR'&&f.compareDoctorIds?.length?f.compareDoctorIds:[]
  const dept=f.departmentId
  const plain=(rows:unknown[])=>rows.map(r=>({...r as object}))
  try{
    const doctorOptions=plain(db.prepare(`SELECT dr.id,dr.name,dr.specialty,dr.department_id,d.name department_name,dr.consultation_fee,dr.experience_years,dr.active,dr.availability_status FROM doctors dr JOIN departments d ON d.id=dr.department_id WHERE dr.active=1 AND (? IS NULL OR dr.department_id=?) AND (? IS NULL OR dr.specialty=?) AND (? IS NULL OR dr.id=?) ORDER BY dr.name`).all(dept||null,dept||null,f.specialty||null,f.specialty||null,comparisonIds.length?null:doctorId||null,comparisonIds.length?null:doctorId||null))
    const departmentOptions=plain(db.prepare('SELECT id,name FROM departments WHERE active=1 ORDER BY name').all())
    const base={page:f.page,range:{start,end,grain},doctors:doctorOptions,departments:departmentOptions}
    if(f.page==='PATIENTS'){
      const where=['datetime(p.created_at)>=datetime(?)','datetime(p.created_at)<datetime(?)'],params:any[]=[from,until]
      if(dept){where.push('p.department_id=?');params.push(dept)}
      if(session.role==='DOCTOR'){where.push('p.doctor_id=?');params.push(doctorId)}
      if(f.status){where.push('p.status=?');params.push(f.status)}
      if(f.gender){if(f.gender==='__MISSING__')where.push("COALESCE(NULLIF(p.gender,''),'Not recorded')='Not recorded'");else{where.push('p.gender=?');params.push(f.gender)}}if(f.bloodGroup){if(f.bloodGroup==='__MISSING__')where.push("COALESCE(NULLIF(p.blood_group,''),'Not recorded')='Not recorded'");else{where.push('p.blood_group=?');params.push(f.bloodGroup)}}
      if(f.ageGroup){const expr="CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER)";const ranges:Record<string,string>={'0-17':`${expr} BETWEEN 0 AND 17`,'18-35':`${expr} BETWEEN 18 AND 35`,'36-59':`${expr} BETWEEN 36 AND 59`,'60+':`${expr} >= 60`,'unknown':'p.date_of_birth IS NULL'};if(ranges[f.ageGroup])where.push(ranges[f.ageGroup])}
      const w=where.join(' AND ')
      const k=db.prepare(`SELECT COUNT(*) total,SUM(status='ACTIVE') active,SUM(status!='ACTIVE') inactive,SUM(date(created_at,'+5 hours','+30 minutes')=date('now','+5 hours','+30 minutes')) today FROM patients p WHERE ${w}`).get(...params) as Record<string,any>
      const returning=db.prepare(`SELECT COUNT(DISTINCT a.patient_id) n FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.status='COMPLETED' AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) AND EXISTS(SELECT 1 FROM appointments prior WHERE prior.patient_id=a.patient_id AND prior.status='COMPLETED' AND datetime(prior.starts_at)<datetime(a.starts_at))${dept?' AND p.department_id=?':''}${session.role==='DOCTOR'?' AND p.doctor_id=?':''}${f.status?' AND p.status=?':''}${f.gender?(f.gender==='__MISSING__'?" AND COALESCE(NULLIF(p.gender,''),'Not recorded')='Not recorded'":" AND p.gender=?"):''}${f.bloodGroup?(f.bloodGroup==='__MISSING__'?" AND COALESCE(NULLIF(p.blood_group,''),'Not recorded')='Not recorded'":" AND p.blood_group=?"):''}${f.ageGroup?` AND ${f.ageGroup==='unknown'?'p.date_of_birth IS NULL':`CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER) ${f.ageGroup==='0-17'?'BETWEEN 0 AND 17':f.ageGroup==='18-35'?'BETWEEN 18 AND 35':f.ageGroup==='36-59'?'BETWEEN 36 AND 59':'>= 60'}`}`:''}`).get(from,until,...(dept?[dept]:[]),...(session.role==='DOCTOR'?[doctorId!]:[]),...(f.status?[f.status]:[]),...(f.gender&&f.gender!=='__MISSING__'?[f.gender]:[]),...(f.bloodGroup&&f.bloodGroup!=='__MISSING__'?[f.bloodGroup]:[])) as {n:number}
      const trend=db.prepare(`SELECT ${period.replace('X','p.created_at')} label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const weeklyGrowth=db.prepare(`SELECT strftime('%Y-W%W',p.created_at,'+5 hours','+30 minutes') label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const monthlyGrowth=db.prepare(`SELECT strftime('%Y-%m',p.created_at,'+5 hours','+30 minutes') label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const heatmap=db.prepare(`SELECT strftime('%w',created_at,'+5 hours','+30 minutes') dow,CAST(strftime('%H',created_at,'+5 hours','+30 minutes') AS INTEGER) hour,COUNT(*) value FROM patients p WHERE ${w} GROUP BY dow,hour ORDER BY dow,hour`).all(...params)
      const gender=db.prepare(`SELECT COALESCE(NULLIF(gender,''),'Not recorded') label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY value DESC`).all(...params)
      const blood=db.prepare(`SELECT COALESCE(NULLIF(blood_group,''),'Not recorded') label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY value DESC`).all(...params)
      const age=db.prepare(`SELECT CASE WHEN p.date_of_birth IS NULL THEN 'Unknown' WHEN CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER)<18 THEN '0â€“17' WHEN CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER)<36 THEN '18â€“35' WHEN CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER)<60 THEN '36â€“59' ELSE '60+' END label,COUNT(*) value FROM patients p WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const department=db.prepare(`SELECT d.name label,COUNT(*) value FROM patients p LEFT JOIN departments d ON d.id=p.department_id WHERE ${w} GROUP BY d.id ORDER BY value DESC`).all(...params)
      const newReturning=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,COUNT(DISTINCT CASE WHEN NOT EXISTS(SELECT 1 FROM appointments prior WHERE prior.patient_id=a.patient_id AND prior.status='COMPLETED' AND datetime(prior.starts_at)<datetime(a.starts_at)) THEN a.patient_id END) new,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM appointments prior WHERE prior.patient_id=a.patient_id AND prior.status='COMPLETED' AND datetime(prior.starts_at)<datetime(a.starts_at)) THEN a.patient_id END) AS "returning" FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.status='COMPLETED' AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?)${dept?' AND p.department_id=?':''}${session.role==='DOCTOR'?' AND p.doctor_id=?':''}${f.status?' AND p.status=?':''}${f.gender?(f.gender==='__MISSING__'?" AND COALESCE(NULLIF(p.gender,''),'Not recorded')='Not recorded'":" AND p.gender=?"):''}${f.bloodGroup?(f.bloodGroup==='__MISSING__'?" AND COALESCE(NULLIF(p.blood_group,''),'Not recorded')='Not recorded'":" AND p.blood_group=?"):''} GROUP BY label ORDER BY label`).all(from,until,...(dept?[dept]:[]),...(session.role==='DOCTOR'?[doctorId!]:[]),...(f.status?[f.status]:[]),...(f.gender&&f.gender!=='__MISSING__'?[f.gender]:[]),...(f.bloodGroup&&f.bloodGroup!=='__MISSING__'?[f.bloodGroup]:[]))
      const todayFrom=toUtcBoundary(today),todayUntil=toUtcBoundary(addDate(today,1)),monthStart=toUtcBoundary(`${today.slice(0,7)}-01`),monthUntil=toUtcBoundary(`${addMonths(today,1).slice(0,7)}-01`)
      const scopedCount=(lo:string,hi:string)=>{const extra:string[]=[],extraParams:any[]=[];if(f.gender){if(f.gender==='__MISSING__')extra.push("COALESCE(NULLIF(p.gender,''),'Not recorded')='Not recorded'");else{extra.push('p.gender=?');extraParams.push(f.gender)}}if(f.bloodGroup){if(f.bloodGroup==='__MISSING__')extra.push("COALESCE(NULLIF(p.blood_group,''),'Not recorded')='Not recorded'");else{extra.push('p.blood_group=?');extraParams.push(f.bloodGroup)}}if(f.ageGroup){const ageExpr="CAST((julianday('now')-julianday(p.date_of_birth))/365.2425 AS INTEGER)";const ageSql:Record<string,string>={'0-17':`${ageExpr} BETWEEN 0 AND 17`,'18-35':`${ageExpr} BETWEEN 18 AND 35`,'36-59':`${ageExpr} BETWEEN 36 AND 59`,'60+':`${ageExpr} >= 60`,'unknown':'p.date_of_birth IS NULL'};if(ageSql[f.ageGroup])extra.push(ageSql[f.ageGroup])}return Number((db.prepare(`SELECT COUNT(*) n FROM patients p WHERE datetime(p.created_at)>=datetime(?) AND datetime(p.created_at)<datetime(?)${dept?' AND p.department_id=?':''}${session.role==='DOCTOR'?' AND p.doctor_id=?':''}${f.status?' AND p.status=?':''}${extra.length?' AND '+extra.join(' AND '):''}`).get(lo,hi,...(dept?[dept]:[]),...(session.role==='DOCTOR'?[doctorId!]:[]),...(f.status?[f.status]:[]),...extraParams) as {n:number}).n||0)}
      const todayRegistrations=scopedCount(todayFrom,todayUntil),newThisMonth=scopedCount(monthStart,monthUntil)
      const previousEnd=addDate(start,-1),previousStart=addDate(previousEnd,-(days-1)),previousCount=scopedCount(toUtcBoundary(previousStart),toUtcBoundary(addDate(previousEnd,1)))
      const total=Number(k.total||0),growth=previousCount>0?Number(((total-previousCount)/previousCount*100).toFixed(1)):null
      const dailyByDate=new Map(plain(trend).map((row:any)=>[String(row.label),Number(row.value||0)])),dailyTrend=Array.from({length:days},(_,index)=>{const label=addDate(start,index);return {label,value:dailyByDate.get(label)||0}})
      const records=db.prepare(`SELECT p.*,d.name department_name,dr.name doctor_name FROM patients p LEFT JOIN departments d ON d.id=p.department_id LEFT JOIN doctors dr ON dr.id=p.doctor_id WHERE ${w} ORDER BY p.created_at DESC LIMIT 300`).all(...params)
      return {ok:true as const,data:{...base,kpis:{total,active:Number(k.active||0),inactive:Number(k.inactive||0),today:todayRegistrations,newThisMonth,returning:Number(returning.n||0),averageDaily:Number((total/Math.max(days,1)).toFixed(1)),growth,previousCount},trend:dailyTrend,weeklyGrowth:plain(weeklyGrowth),monthlyGrowth:plain(monthlyGrowth),gender:plain(gender),blood:plain(blood),age:plain(age),department:plain(department),newReturning:plain(newReturning),heatmap:plain(heatmap),records:plain(records)}}
    }
    if(f.page==='APPOINTMENTS'){
      const where=['datetime(a.starts_at)>=datetime(?)','datetime(a.starts_at)<datetime(?)'],params:any[]=[from,until]
      if(dept){where.push('a.department_id=?');params.push(dept)}if(doctorId){where.push('a.doctor_id=?');params.push(doctorId)}if(f.status){where.push('a.status=?');params.push(f.status)}if(f.type){where.push('a.type=?');params.push(f.type)}
      const w=where.join(' AND '),k=db.prepare(`SELECT COUNT(*) total,SUM(date(a.starts_at,'+5 hours','+30 minutes')=date('now','+5 hours','+30 minutes')) today,SUM(datetime(a.starts_at)>=datetime('now') AND a.status='SCHEDULED') upcoming,SUM(a.status='COMPLETED') completed,SUM(a.status='CANCELLED') cancelled,SUM(a.status='MISSED') missed FROM appointments a WHERE ${w}`).get(...params) as Record<string,any>
      const upcomingWhere=['datetime(a.starts_at)>=datetime(?)','datetime(a.starts_at)<datetime(?)',"a.status='SCHEDULED'"]
      const upcomingParams:any[]=[new Date().toISOString(),toUtcBoundary(addDate(today,31))]
      if(dept){upcomingWhere.push('a.department_id=?');upcomingParams.push(dept)}
      if(doctorId){upcomingWhere.push('a.doctor_id=?');upcomingParams.push(doctorId)}
      if(f.status){upcomingWhere.push('a.status=?');upcomingParams.push(f.status)}
      if(f.type){upcomingWhere.push('a.type=?');upcomingParams.push(f.type)}
      const upcomingCount=Number((db.prepare(`SELECT COUNT(*) n FROM appointments a WHERE ${upcomingWhere.join(' AND ')}`).get(...upcomingParams) as {n:number}).n||0)
      const status=db.prepare(`SELECT a.status label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY a.status ORDER BY value DESC`).all(...params)
      const daily=db.prepare(`SELECT strftime('%w',a.starts_at) dow,strftime('%H',a.starts_at) hour,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY dow,hour`).all(...params) as Record<string,any>[]
      const daysOfWeek=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],hours=Array.from({length:12},(_,i)=>({hour:String(i+8).padStart(2,'0'),label:`${String(i+8).padStart(2,'0')}:00`}))
      const heatmap=daysOfWeek.flatMap((label,dow)=>hours.map(h=>({label:`${label} ${h.label}`,day:label,hour:h.hour,value:Number(daily.find(r=>Number(r.dow)===dow&&r.hour===h.hour)?.value||0)})))
      const trend=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const weekly=db.prepare(`SELECT strftime('%w',a.starts_at,'+5 hours','+30 minutes') dow,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY dow`).all(...params)
      const volume=db.prepare(`SELECT strftime('%Y-%m-%d',a.starts_at) label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const doctors=db.prepare(`SELECT dr.name label,COUNT(*) value FROM appointments a JOIN doctors dr ON dr.id=a.doctor_id WHERE ${w} GROUP BY dr.id ORDER BY value DESC LIMIT 12`).all(...params)
      const departments=db.prepare(`SELECT d.name label,COUNT(*) value FROM appointments a JOIN departments d ON d.id=a.department_id WHERE ${w} GROUP BY d.id ORDER BY value DESC`).all(...params)
      const cancelTrend=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,SUM(a.status='CANCELLED') cancelled,SUM(a.status='MISSED') missed FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
      const typeDistribution=db.prepare(`SELECT a.type label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY a.type ORDER BY value DESC`).all(...params)
      const records=db.prepare(`SELECT a.*,p.first_name||' '||p.last_name patient_name,p.patient_number,dr.name doctor_name,d.name department_name FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors dr ON dr.id=a.doctor_id JOIN departments d ON d.id=a.department_id WHERE ${w} ORDER BY a.starts_at DESC LIMIT 500`).all(...params)
      return {ok:true as const,data:{...base,kpis:Object.fromEntries(Object.entries({...k,upcoming:upcomingCount}).map(([key,value])=>[key,Number(value||0)])),status:plain(status),trend:plain(trend),volume:plain(volume),weekly:plain(weekly),doctors:plain(doctors),department:plain(departments),heatmap,cancelTrend:plain(cancelTrend),typeDistribution:plain(typeDistribution),records:plain(records),types:plain(db.prepare('SELECT DISTINCT type value FROM appointments ORDER BY type').all())}}
    }
    if(f.page==='DOCTORS'){
      const w=['datetime(a.starts_at)>=datetime(?)','datetime(a.starts_at)<datetime(?)'],params:any[]=[from,until]
      if(dept){w.push('dr.department_id=?');params.push(dept)}if(f.specialty){w.push('dr.specialty=?');params.push(f.specialty)}if(doctorId){w.push('dr.id=?');params.push(doctorId)}
      const where=w.join(' AND '),doctorWhere=['dr.active=1',...(dept?['dr.department_id=?']:[]),...(f.specialty?['dr.specialty=?']:[]),...(doctorId?['dr.id=?']:[])].join(' AND '),dp=[...(dept?[dept]:[]),...(f.specialty?[f.specialty]:[]),...(doctorId?[doctorId]:[])]
      const k=db.prepare(`SELECT COUNT(*) total,SUM(dr.active=1 AND dr.availability_status='AVAILABLE') available,SUM(dr.availability_status='ON_LEAVE') onLeave,COUNT(DISTINCT dr.specialty) specializations FROM doctors dr WHERE (? IS NULL OR dr.department_id=?) AND (? IS NULL OR dr.specialty=?) AND (? IS NULL OR dr.id=?)`).get(dept||null,dept||null,f.specialty||null,f.specialty||null,doctorId||null,doctorId||null) as Record<string,any>
      const availability=db.prepare(`SELECT CASE WHEN dr.active=0 THEN 'Inactive profile' WHEN dr.availability_status='ON_LEAVE' THEN 'On leave' WHEN dr.availability_status='UNAVAILABLE' THEN 'Unavailable' ELSE 'Available' END label,COUNT(*) value FROM doctors dr WHERE (? IS NULL OR dr.department_id=?) AND (? IS NULL OR dr.specialty=?) AND (? IS NULL OR dr.id=?) GROUP BY label ORDER BY value DESC`).all(dept||null,dept||null,f.specialty||null,f.specialty||null,doctorId||null,doctorId||null)
      const bySpecialty=db.prepare(`SELECT dr.specialty label,COUNT(*) value FROM doctors dr WHERE ${doctorWhere} GROUP BY dr.specialty ORDER BY value DESC`).all(...dp)
      const byDepartment=db.prepare(`SELECT d.name label,COUNT(*) value FROM doctors dr JOIN departments d ON d.id=dr.department_id WHERE ${doctorWhere} GROUP BY d.id ORDER BY value DESC`).all(...dp)
      const workload=db.prepare(`SELECT dr.name label,SUM(a.status='COMPLETED') value,COUNT(a.id) appointments FROM doctors dr LEFT JOIN appointments a ON a.doctor_id=dr.id AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) WHERE ${doctorWhere} GROUP BY dr.id ORDER BY value DESC`).all(from,until,...dp)
      const schedule=db.prepare(`SELECT dr.name doctor_name,ds.day_of_week day,ds.start_time,ds.end_time,ds.slot_minutes FROM doctor_schedules ds JOIN doctors dr ON dr.id=ds.doctor_id WHERE ds.active=1 AND ${doctorWhere.replaceAll('dr.','dr.')} ORDER BY day,ds.start_time`).all(...dp)
      const consultationTrend=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,COUNT(*) value FROM appointments a JOIN doctors dr ON dr.id=a.doctor_id WHERE ${where} AND a.status='COMPLETED' GROUP BY label ORDER BY label`).all(...params)
      const fees=db.prepare(`SELECT dr.name label,dr.consultation_fee*SUM(a.status='COMPLETED') value FROM doctors dr LEFT JOIN appointments a ON a.doctor_id=dr.id AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) WHERE ${doctorWhere} GROUP BY dr.id ORDER BY value DESC`).all(from,until,...dp)
      const doctors=db.prepare(`SELECT dr.*,d.name department_name,(SELECT COUNT(*) FROM appointments a WHERE a.doctor_id=dr.id AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?)) appointments,(SELECT COUNT(*) FROM appointments a WHERE a.doctor_id=dr.id AND datetime(a.starts_at)>=datetime(?) AND datetime(a.starts_at)<datetime(?) AND a.status='COMPLETED') completed,(SELECT COUNT(*) FROM consultations c WHERE c.doctor_id=dr.id AND datetime(c.created_at)>=datetime(?) AND datetime(c.created_at)<datetime(?)) consultations FROM doctors dr JOIN departments d ON d.id=dr.department_id WHERE ${doctorWhere} ORDER BY dr.name`).all(from,until,from,until,from,until,...dp)
      const monthlyActivity=db.prepare(`SELECT strftime('%Y-%m',a.starts_at) label,COUNT(*) appointments,SUM(a.status='COMPLETED') completed FROM appointments a JOIN doctors dr ON dr.id=a.doctor_id WHERE ${where} GROUP BY label ORDER BY label`).all(...params)
      return {ok:true as const,data:{...base,kpis:{total:Number(k.total||0),available:Number(k.available||0),onLeave:Number(k.onLeave||0),specializations:Number(k.specializations||0),consultations:Number((db.prepare(`SELECT COUNT(*) n FROM consultations c JOIN doctors dr ON dr.id=c.doctor_id WHERE datetime(c.created_at)>=datetime(?) AND datetime(c.created_at)<datetime(?)${dept?' AND dr.department_id=?':''}${f.specialty?' AND dr.specialty=?':''}${doctorId?' AND dr.id=?':''}`).get(from,until,...dp) as {n:number}).n||0)},availability:plain(availability),bySpecialty:plain(bySpecialty),byDepartment:plain(byDepartment),workload:plain(workload),fees:plain(fees),schedule:plain(schedule),trend:plain(consultationTrend),monthly:plain(monthlyActivity),records:plain(doctors),untracked:['On-duty state is not separately stored. Doctor availability uses the profile availability status.','Consultation counts use appointment completion where the app does not create consultation records consistently.','Doctor-specific collected revenue is not linked; fee Ã— completed appointments is an estimate, not actual collections.']}}
    }
    // Overview and Doctor Analytics share the same verified appointment, payment, patient and lab sources.
    const where=['datetime(a.starts_at)>=datetime(?)','datetime(a.starts_at)<datetime(?)'],params:any[]=[from,until]
    if(dept){where.push('a.department_id=?');params.push(dept)}if(comparisonIds.length){where.push(`a.doctor_id IN (${comparisonIds.map(()=>'?').join(',')})`);params.push(...comparisonIds)}else if(doctorId){where.push('a.doctor_id=?');params.push(doctorId)}if(f.status){where.push('a.status=?');params.push(f.status)}if(f.type){where.push('a.type=?');params.push(f.type)}
    const w=where.join(' AND ')
    const appt=db.prepare(`SELECT COUNT(*) total,SUM(a.status='COMPLETED') completed,SUM(a.status='CANCELLED') cancelled,SUM(a.status='MISSED') missed,SUM(date(a.starts_at,'+5 hours','+30 minutes')=date('now','+5 hours','+30 minutes')) today,SUM(datetime(a.starts_at)>=datetime('now') AND a.status='SCHEDULED') upcoming,AVG((julianday(a.ends_at)-julianday(a.starts_at))*1440) averageDuration FROM appointments a WHERE ${w}`).get(...params) as Record<string,any>
    const upcomingWhere=['datetime(a.starts_at)>=datetime(?)','datetime(a.starts_at)<datetime(?)',"a.status='SCHEDULED'"]
    const upcomingParams:any[]=[new Date().toISOString(),toUtcBoundary(addDate(today,31))]
    if(dept){upcomingWhere.push('a.department_id=?');upcomingParams.push(dept)}
    if(comparisonIds.length){upcomingWhere.push(`a.doctor_id IN (${comparisonIds.map(()=>'?').join(',')})`);upcomingParams.push(...comparisonIds)}else if(doctorId){upcomingWhere.push('a.doctor_id=?');upcomingParams.push(doctorId)}
    if(f.status){upcomingWhere.push('a.status=?');upcomingParams.push(f.status)}
    if(f.type){upcomingWhere.push('a.type=?');upcomingParams.push(f.type)}
    const upcomingAppointments=Number((db.prepare(`SELECT COUNT(*) n FROM appointments a WHERE ${upcomingWhere.join(' AND ')}`).get(...upcomingParams) as {n:number}).n||0)
    const patientsTreated=db.prepare(`SELECT COUNT(DISTINCT a.patient_id) n FROM appointments a WHERE ${w} AND a.status='COMPLETED'`).get(...params) as {n:number}
    const completedPerDay=Number(appt.completed||0)/Math.max(days,1)
    const status=db.prepare(`SELECT a.status label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY a.status`).all(...params)
    const trend=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,COUNT(*) value FROM appointments a WHERE ${w} AND a.status='COMPLETED' GROUP BY label ORDER BY label`).all(...params)
    const byDoctorRaw=db.prepare(`SELECT dr.name label,COUNT(*) appointments,SUM(a.status='COMPLETED') completed,COUNT(DISTINCT CASE WHEN a.status='COMPLETED' THEN a.patient_id END) patients,ROUND(AVG((julianday(a.ends_at)-julianday(a.starts_at))*1440),1) duration,dr.consultation_fee fee,COALESCE((SELECT SUM((CAST(substr(ds.end_time,1,2) AS INTEGER)*60+CAST(substr(ds.end_time,4,2) AS INTEGER)-CAST(substr(ds.start_time,1,2) AS INTEGER)*60-CAST(substr(ds.start_time,4,2) AS INTEGER))/60.0) FROM doctor_schedules ds WHERE ds.doctor_id=dr.id AND ds.active=1),0) scheduled_hours_week FROM appointments a JOIN doctors dr ON dr.id=a.doctor_id WHERE ${w} GROUP BY dr.id ORDER BY completed DESC`).all(...params) as Record<string,any>[]
    const byDoctor=byDoctorRaw.map(row=>({...row,completed_per_scheduled_hour:Number(row.scheduled_hours_week)>0?Number(row.completed||0)/Number(row.scheduled_hours_week):null}))
    const byDepartment=db.prepare(`SELECT d.name label,COUNT(DISTINCT a.patient_id) value FROM appointments a JOIN departments d ON d.id=a.department_id WHERE ${w} GROUP BY d.id ORDER BY value DESC`).all(...params)
    const revenue=db.prepare(`SELECT COALESCE(SUM(p.amount),0) value FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE datetime(p.created_at)>=datetime(?) AND datetime(p.created_at)<datetime(?)`).get(from,until) as {value:number}
    const paymentTrend=db.prepare(`SELECT ${period.replace('X','p.created_at')} label,COALESCE(SUM(p.amount),0) value FROM payments p WHERE datetime(p.created_at)>=datetime(?) AND datetime(p.created_at)<datetime(?) GROUP BY label ORDER BY label`).all(from,until)
    const billingAccess=['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST','ACCOUNTANT'].includes(session.role)
    const pendingBalance=billingAccess?Number((db.prepare(`SELECT MAX(0,COALESCE(SUM((SELECT COALESCE(SUM(ii.quantity*ii.unit_price-ii.discount+ii.tax),0) FROM invoice_items ii WHERE ii.invoice_id=i.id)),0)-COALESCE(SUM((SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id)),0)) value FROM invoices i WHERE datetime(i.created_at)>=datetime(?) AND datetime(i.created_at)<datetime(?)`).get(from,until) as {value:number|null}).value||0):null
    const registrations=db.prepare(`SELECT ${period.replace('X','p.created_at')} label,COUNT(*) value FROM patients p WHERE datetime(p.created_at)>=datetime(?) AND datetime(p.created_at)<datetime(?) GROUP BY label ORDER BY label`).all(from,until)
    const visit=db.prepare(`SELECT strftime('%Y-%m-%d',a.starts_at) label,COUNT(*) value FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
    const billedDepartment=db.prepare(`SELECT d.name label,COALESCE(SUM((SELECT COALESCE(SUM(ii.quantity*ii.unit_price-ii.discount+ii.tax),0) FROM invoice_items ii WHERE ii.invoice_id=i.id)),0) value FROM invoices i JOIN departments d ON d.id=(SELECT a.department_id FROM appointments a WHERE a.patient_id=i.patient_id AND a.starts_at<=i.created_at ORDER BY a.starts_at DESC LIMIT 1) WHERE datetime(i.created_at)>=datetime(?) AND datetime(i.created_at)<datetime(?)${dept?' AND d.id=?':''} GROUP BY d.id ORDER BY value DESC`).all(from,until,...(dept?[dept]:[]))
    const monthly=db.prepare(`SELECT strftime('%Y-%m',a.starts_at) label,COUNT(*) appointments,SUM(a.status='COMPLETED') completed,SUM(a.status='CANCELLED') cancelled FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
    const monthlyByDoctor=db.prepare(`SELECT strftime('%Y-%m',a.starts_at) label,dr.id doctor_id,dr.name doctor_name,COUNT(*) value FROM appointments a JOIN doctors dr ON dr.id=a.doctor_id WHERE ${w} GROUP BY label,dr.id ORDER BY label,dr.name`).all(...params)
    const patientCohorts=db.prepare(`SELECT ${period.replace('X','a.starts_at')} label,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM appointments prior WHERE prior.patient_id=a.patient_id AND prior.starts_at<a.starts_at) THEN a.patient_id END) AS "returning",COUNT(DISTINCT CASE WHEN NOT EXISTS(SELECT 1 FROM appointments prior WHERE prior.patient_id=a.patient_id AND prior.starts_at<a.starts_at) THEN a.patient_id END) new FROM appointments a WHERE ${w} GROUP BY label ORDER BY label`).all(...params)
    const patientStats=db.prepare(`SELECT COUNT(*) total,SUM(status='ACTIVE') active,SUM(status!='ACTIVE') inactive FROM patients WHERE datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)`).get(from,until) as Record<string,any>
    const labs=db.prepare(`SELECT COUNT(*) n FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id WHERE datetime(l.created_at)>=datetime(?) AND datetime(l.created_at)<datetime(?)`).get(from,until) as {n:number}
    const pharmacy=db.prepare(`SELECT COALESCE(SUM(-t.quantity*b.selling_price),0) value FROM stock_transactions t JOIN medicine_batches b ON b.id=t.batch_id WHERE t.quantity<0 AND (t.reason LIKE '%DISPENS%' OR t.reason LIKE '%SALE%') AND datetime(t.created_at)>=datetime(?) AND datetime(t.created_at)<datetime(?)`).get(from,until) as {value:number}
    const records=db.prepare(`SELECT a.*,p.first_name||' '||p.last_name patient_name,dr.name doctor_name,d.name department_name FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors dr ON dr.id=a.doctor_id JOIN departments d ON d.id=a.department_id WHERE ${w} ORDER BY a.starts_at DESC LIMIT 300`).all(...params)
    return {ok:true as const,data:{...base,kpis:{total:Number(appt.total||0),totalPatients:Number(patientStats.total||0),activePatients:Number(patientStats.active||0),totalDoctors:Number((db.prepare('SELECT COUNT(*) n FROM doctors').get() as {n:number}).n||0),availableDoctors:doctorOptions.filter((doctor:any)=>doctor.availability_status==='AVAILABLE').length,todayAppointments:Number(appt.today||0),upcomingAppointments,totalAppointments:Number(appt.total||0),completed:Number(appt.completed||0),cancelled:Number(appt.cancelled||0),missed:Number(appt.missed||0),patientsTreated:Number(patientsTreated.n||0),averagePerDay:Number(completedPerDay.toFixed(1)),cancellationRate:appt.total?Number((Number(appt.cancelled||0)/Number(appt.total)*100).toFixed(1)):0,revenueReceived:billingAccess?Number(revenue.value||0):null,pendingPayments:pendingBalance,labs:Number(labs.n||0),pharmacySales:billingAccess?Number(pharmacy.value||0):null,averageDuration:appt.averageDuration?Number(Number(appt.averageDuration).toFixed(1)):null,totalConsultations:Number((db.prepare(`SELECT COUNT(*) n FROM consultations c WHERE datetime(c.created_at)>=datetime(?) AND datetime(c.created_at)<datetime(?)${doctorId?' AND c.doctor_id=?':''}`).get(from,until,...(doctorId?[doctorId]:[])) as {n:number}).n||0)},status:plain(status),trend:plain(trend),paymentTrend:billingAccess?plain(paymentTrend):[],registrations:plain(registrations),department:plain(byDepartment),visits:plain(visit),revenueDepartment:billingAccess?plain(billedDepartment):[],monthly:plain(monthly),monthlyByDoctor:plain(monthlyByDoctor),patientCohorts:plain(patientCohorts),byDoctor:plain(byDoctor),records:plain(records),untracked:['Admission and discharge events are not recorded.','Department revenue is attributed from the patientâ€™s nearest prior appointment because invoice lines do not store a department; it is indicative only.','Doctor on-duty, leave, and actual availability states are not stored; active doctor profiles are counted as available.','Consultation revenue by doctor is not linked to payments; fee estimates are not actual collections.']}}
  }catch(e){return {ok:false as const,error:'Unable to load analytics from the database. Please adjust filters or contact an administrator.'}}
}

export async function createLabOrder(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','DOCTOR','NURSE'])
  const parsed=labOrderInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check the laboratory order.')
  const {patientId,category,tests}=parsed.data
  const testNames=[...new Set(tests.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))]
  if(!testNames.length)return errorResult('Enter at least one test name.')
  try{
    withTransaction(()=>{
      if(session.role==='DOCTOR'&&!db.prepare('SELECT id FROM patients WHERE id=? AND doctor_id=(SELECT id FROM doctors WHERE user_id=?)').get(patientId,session.userId))throw new Error('PATIENT_SCOPE')
      const orderId=randomUUID()
      db.prepare('INSERT INTO lab_orders(id,patient_id,status) VALUES(?,?,?)').run(orderId,patientId,'ORDERED')
      for(const test of testNames)db.prepare('INSERT INTO lab_order_items(id,lab_order_id,test_name,category) VALUES(?,?,?,?)').run(randomUUID(),orderId,test,category)
      db.prepare('INSERT INTO notifications(id,title,body,type) VALUES(?,?,?,?)').run(randomUUID(),'New laboratory order',`${testNames.length} test(s)`,'LAB')
      logActivity('LAB_ORDER_CREATED',session.userId,patientId)
    })
    revalidatePath('/')
    return {ok:true as const}
  }catch(e){return errorResult(e instanceof Error&&e.message==='PATIENT_SCOPE'?'You can only order tests for your assigned patients.':'Could not create laboratory order.')}
}

export async function saveLabResult(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','LAB_TECHNICIAN'])
  const parsed=labResultInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check the result details.')
  const r=parsed.data
  try{
    withTransaction(()=>{
      const item=db.prepare('SELECT lab_order_id FROM lab_order_items WHERE id=?').get(r.itemId) as {lab_order_id:string}|undefined
      if(!item)throw new Error('ITEM_NOT_FOUND')
      db.prepare(`INSERT INTO lab_results(id,item_id,value,unit,reference_range,recorded_by_id,source,method) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET value=excluded.value,unit=excluded.unit,reference_range=excluded.reference_range,recorded_by_id=excluded.recorded_by_id,source=excluded.source,method=excluded.method,abnormal=0,verified_at=NULL,published_at=NULL`).run(randomUUID(),r.itemId,r.value,r.unit||null,r.referenceRange||null,session.userId,'Laboratory entry',r.method||null)
      db.prepare("UPDATE lab_order_items SET status='COMPLETED',sample_collected_at=COALESCE(sample_collected_at,CURRENT_TIMESTAMP),processing_started_at=COALESCE(processing_started_at,CURRENT_TIMESTAMP) WHERE id=?").run(r.itemId)
      const pending=db.prepare("SELECT COUNT(*) AS n FROM lab_order_items WHERE lab_order_id=? AND status NOT IN ('COMPLETED','VERIFIED')").get(item.lab_order_id) as {n:number}
      if(!pending.n)db.prepare("UPDATE lab_orders SET status='COMPLETED' WHERE id=?").run(item.lab_order_id)
      logActivity('LAB_RESULT_RECORDED',session.userId,null,item.lab_order_id)
    })
    revalidatePath('/')
    return {ok:true as const}
  }catch{return errorResult('Could not save this laboratory result.')}
}

export async function verifyLabResult(itemId:string){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','DOCTOR'])
  try{
    const result=db.prepare('UPDATE lab_results SET verified_at=CURRENT_TIMESTAMP,published_at=CURRENT_TIMESTAMP WHERE item_id=?').run(itemId)
    if(!result.changes)return errorResult('Save the result before verifying it.')
    const order=db.prepare('SELECT lab_order_id FROM lab_order_items WHERE id=?').get(itemId) as {lab_order_id:string}
    db.prepare("UPDATE lab_order_items SET status='VERIFIED',sample_collected_at=COALESCE(sample_collected_at,CURRENT_TIMESTAMP),processing_started_at=COALESCE(processing_started_at,CURRENT_TIMESTAMP) WHERE id=?").run(itemId)
    const pending=db.prepare("SELECT COUNT(*) AS n FROM lab_order_items WHERE lab_order_id=? AND status!='VERIFIED'").get(order.lab_order_id) as {n:number}
    if(!pending.n)db.prepare("UPDATE lab_orders SET status='VERIFIED' WHERE id=?").run(order.lab_order_id)
    logActivity('LAB_RESULT_VERIFIED',session.userId,null,order.lab_order_id)
    revalidatePath('/')
    return {ok:true as const}
  }catch{return errorResult('Could not verify the result.')}
}

export async function addMedicineBatch(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','PHARMACIST'])
  const parsed=medicineInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check medicine details.')
  const m=parsed.data
  try{
    withTransaction(()=>{
      const existing=db.prepare('SELECT id FROM medicines WHERE name=? COLLATE NOCASE').get(m.name) as {id:string}|undefined
      const medicineId=existing?.id||randomUUID()
      if(existing)db.prepare('UPDATE medicines SET category=?,minimum_stock=? WHERE id=?').run(m.category,m.minimumStock,medicineId)
      else db.prepare('INSERT INTO medicines(id,name,category,minimum_stock) VALUES(?,?,?,?)').run(medicineId,m.name,m.category,m.minimumStock)
      const batchId=randomUUID()
      db.prepare('INSERT INTO medicine_batches(id,medicine_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES(?,?,?,?,?,?,?)').run(batchId,medicineId,m.batchNumber,m.expiryDate,m.quantity,m.purchasePrice,m.sellingPrice)
      if(m.quantity)db.prepare('INSERT INTO stock_transactions(id,medicine_id,batch_id,quantity,reason) VALUES(?,?,?,?,?)').run(randomUUID(),medicineId,batchId,m.quantity,'PURCHASE_RECEIVED')
      logActivity('PHARMACY_STOCK_RECEIVED',session.userId,null,`${m.name} Â· batch ${m.batchNumber}`)
    })
    revalidatePath('/')
    return {ok:true as const}
  }catch{return errorResult('Could not save this batch. Check for a duplicate batch number.')}
}

export async function createInvoice(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','ACCOUNTANT','RECEPTIONIST'])
  const parsed=invoiceInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check invoice details.')
  const i=parsed.data
  if(i.discount>i.quantity*i.unitPrice)return errorResult('Discount cannot exceed the line amount.')
  try{
    withTransaction(()=>{
      const invoiceId=randomUUID(),invoiceNumber=`INV-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`
      db.prepare('INSERT INTO invoices(id,invoice_number,patient_id,status) VALUES(?,?,?,?)').run(invoiceId,invoiceNumber,i.patientId,'PENDING')
      db.prepare('INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price,discount,tax) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),invoiceId,i.description,i.quantity,i.unitPrice,i.discount,i.tax)
      logActivity('INVOICE_CREATED',session.userId,i.patientId,invoiceNumber)
    })
    revalidatePath('/')
    return {ok:true as const}
  }catch{return errorResult('Could not create invoice.')}
}

export async function recordPayment(formData:FormData){
  const session=await requireRole(['SUPER_ADMIN','HOSPITAL_ADMIN','ACCOUNTANT'])
  const parsed=paymentInput.safeParse(fields(formData))
  if(!parsed.success)return errorResult(parsed.error.issues[0]?.message||'Check payment details.')
  const p=parsed.data
  try{
    withTransaction(()=>{
      const balance=db.prepare('SELECT COALESCE((SELECT SUM(quantity*unit_price-discount+tax) FROM invoice_items WHERE invoice_id=?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=?),0) AS due').get(p.invoiceId,p.invoiceId) as {due:number}|undefined
      if(!balance||balance.due<=0)throw new Error('NO_BALANCE')
      if(p.amount>balance.due)throw new Error('OVERPAY')
      db.prepare('INSERT INTO payments(id,invoice_id,amount,method,reference) VALUES(?,?,?,?,?)').run(randomUUID(),p.invoiceId,p.amount,p.method,p.reference||null)
      const remaining=balance.due-p.amount
      db.prepare('UPDATE invoices SET status=? WHERE id=?').run(remaining===0?'PAID':'PARTIALLY_PAID',p.invoiceId)
      logActivity('PAYMENT_RECEIVED',session.userId,null,p.invoiceId)
    })
    revalidatePath('/')
    return {ok:true as const}
  }catch(e){return errorResult(e instanceof Error&&e.message==='OVERPAY'?'Payment exceeds the outstanding invoice balance.':e instanceof Error&&e.message==='NO_BALANCE'?'This invoice has no outstanding balance.':'Could not record payment.')}
}
