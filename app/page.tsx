import HmsApp from '@/components/hms-app'
import { db } from '@/lib/database'
import { requirePageSession } from '@/lib/session'

export const dynamic='force-dynamic'
type Row=Record<string, any>
type Point={label:string;value:number}
const plainRows=(rows:Row[])=>rows.map(row=>({...row}))

export default async function Page() {
  const user=await requirePageSession()
  const role=user.role
  const management=['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST'].includes(role)
  const clinical=['SUPER_ADMIN','HOSPITAL_ADMIN','RECEPTIONIST','NURSE'].includes(role)
  const ownDoctor=db.prepare('SELECT id FROM doctors WHERE user_id=?').get(user.userId) as {id:string}|undefined
  const patients=management||role==='NURSE'
    ? db.prepare(`SELECT p.*,d.name AS department_name,dr.name AS doctor_name FROM patients p LEFT JOIN departments d ON d.id=p.department_id LEFT JOIN doctors dr ON dr.id=p.doctor_id WHERE p.status='ACTIVE' ORDER BY p.created_at DESC LIMIT 250`).all() as Row[]
    : role==='DOCTOR'&&ownDoctor
      ? db.prepare(`SELECT p.*,d.name AS department_name,dr.name AS doctor_name FROM patients p LEFT JOIN departments d ON d.id=p.department_id LEFT JOIN doctors dr ON dr.id=p.doctor_id WHERE p.status='ACTIVE' AND p.doctor_id=? ORDER BY p.created_at DESC LIMIT 250`).all(ownDoctor.id) as Row[]
      : []
  const appointments=management||role==='NURSE'
    ? db.prepare(`SELECT a.*,p.first_name||' '||p.last_name AS patient_name,p.patient_number,d.name AS department_name,dr.name AS doctor_name FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN departments d ON d.id=a.department_id JOIN doctors dr ON dr.id=a.doctor_id ORDER BY a.starts_at DESC LIMIT 250`).all() as Row[]
    : role==='DOCTOR'&&ownDoctor
      ? db.prepare(`SELECT a.*,p.first_name||' '||p.last_name AS patient_name,p.patient_number,d.name AS department_name,dr.name AS doctor_name FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN departments d ON d.id=a.department_id JOIN doctors dr ON dr.id=a.doctor_id WHERE a.doctor_id=? ORDER BY a.starts_at DESC LIMIT 250`).all(ownDoctor.id) as Row[]
      : []
  const doctors=management||role==='NURSE'
    ? db.prepare('SELECT dr.*,d.name AS department_name FROM doctors dr JOIN departments d ON d.id=dr.department_id ORDER BY dr.active DESC,dr.name').all() as Row[]
    : role==='DOCTOR'&&ownDoctor
      ? db.prepare('SELECT dr.*,d.name AS department_name FROM doctors dr JOIN departments d ON d.id=dr.department_id WHERE dr.id=?').all(ownDoctor.id) as Row[]
      : []
  const departments=db.prepare('SELECT * FROM departments WHERE active=1 ORDER BY name').all() as Row[]
  const labOrders=['SUPER_ADMIN','HOSPITAL_ADMIN','LAB_TECHNICIAN','NURSE'].includes(role)
    ? db.prepare(`SELECT l.*,p.first_name||' '||p.last_name AS patient_name,(SELECT COUNT(*) FROM lab_order_items i WHERE i.lab_order_id=l.id) AS item_count FROM lab_orders l JOIN patients p ON p.id=l.patient_id ORDER BY l.created_at DESC LIMIT 100`).all() as Row[]
    : role==='DOCTOR'&&ownDoctor ? db.prepare(`SELECT l.*,p.first_name||' '||p.last_name AS patient_name,(SELECT COUNT(*) FROM lab_order_items i WHERE i.lab_order_id=l.id) AS item_count FROM lab_orders l JOIN patients p ON p.id=l.patient_id WHERE p.doctor_id=? ORDER BY l.created_at DESC LIMIT 100`).all(ownDoctor.id) as Row[] : []
  const labItems=['SUPER_ADMIN','HOSPITAL_ADMIN','LAB_TECHNICIAN','NURSE'].includes(role)
    ? db.prepare(`SELECT i.*,r.value,r.unit,r.reference_range,r.verified_at,p.first_name||' '||p.last_name AS patient_name FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id LEFT JOIN lab_results r ON r.item_id=i.id ORDER BY l.created_at DESC LIMIT 250`).all() as Row[]
    : role==='DOCTOR'&&ownDoctor ? db.prepare(`SELECT i.*,r.value,r.unit,r.reference_range,r.verified_at,p.first_name||' '||p.last_name AS patient_name FROM lab_order_items i JOIN lab_orders l ON l.id=i.lab_order_id JOIN patients p ON p.id=l.patient_id LEFT JOIN lab_results r ON r.item_id=i.id WHERE p.doctor_id=? ORDER BY l.created_at DESC LIMIT 250`).all(ownDoctor.id) as Row[] : []
  const invoices=['SUPER_ADMIN','HOSPITAL_ADMIN','ACCOUNTANT'].includes(role)
    ? db.prepare(`SELECT i.*,p.first_name||' '||p.last_name AS patient_name,(SELECT COALESCE(SUM(quantity*unit_price-discount+tax),0) FROM invoice_items x WHERE x.invoice_id=i.id) AS total,(SELECT COALESCE(SUM(amount),0) FROM payments pay WHERE pay.invoice_id=i.id) AS paid FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 100`).all() as Row[] : []
  const medicineBatches=['SUPER_ADMIN','HOSPITAL_ADMIN','PHARMACIST'].includes(role)
    ? db.prepare('SELECT b.*,m.name,m.category,m.minimum_stock FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id WHERE m.active=1 ORDER BY b.expiry_date LIMIT 200').all() as Row[] : []
  const activities=['SUPER_ADMIN','HOSPITAL_ADMIN'].includes(role)
    ? db.prepare(`SELECT a.*,u.name AS staff_name,p.first_name||' '||p.last_name AS patient_name FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN patients p ON p.id=a.patient_id ORDER BY a.created_at DESC LIMIT 20`).all() as Row[] : []
  const vitals=clinical||role==='DOCTOR'
    ? ownDoctor&&role==='DOCTOR' ? db.prepare(`SELECT v.*,u.name AS staff_name FROM vitals v JOIN users u ON u.id=v.entered_by_id JOIN patients p ON p.id=v.patient_id WHERE p.doctor_id=? ORDER BY v.recorded_at DESC LIMIT 300`).all(ownDoctor.id) as Row[] : db.prepare(`SELECT v.*,u.name AS staff_name FROM vitals v JOIN users u ON u.id=v.entered_by_id ORDER BY v.recorded_at DESC LIMIT 300`).all() as Row[] : []
  const staff=['SUPER_ADMIN','HOSPITAL_ADMIN'].includes(role)
    ? db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY name').all() as Row[] : []
  const todayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const today=db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE date(starts_at,'+5 hours','+30 minutes')=?").get(todayKey) as {n:number}
  const newPatients=db.prepare("SELECT COUNT(*) AS n FROM patients WHERE date(created_at,'+5 hours','+30 minutes')=?").get(todayKey) as {n:number}
  const allStats={
    patients:(db.prepare("SELECT COUNT(*) AS n FROM patients WHERE status='ACTIVE'").get() as {n:number}).n,
    newPatients:newPatients.n,todayAppointments:today.n,
    completed:(db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE date(starts_at,'+5 hours','+30 minutes')=? AND status='COMPLETED'").get(todayKey) as {n:number}).n,
    doctors:doctors.length,
    pendingLabs:(db.prepare("SELECT COUNT(*) AS n FROM lab_orders WHERE status NOT IN ('COMPLETED','VERIFIED','CANCELLED')").get() as {n:number}).n,
    stockAlerts:(db.prepare('SELECT COUNT(*) AS n FROM (SELECT m.id FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id GROUP BY m.id HAVING COALESCE(SUM(b.quantity),0)<=m.minimum_stock OR MIN(b.expiry_date)<date(\'now\',\'+60 days\'))').get() as {n:number}).n,
    revenue:(db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM payments').get() as {n:number}).n,
    outstanding:(db.prepare('SELECT MAX(COALESCE((SELECT SUM(quantity*unit_price-discount+tax) FROM invoice_items),0)-COALESCE((SELECT SUM(amount) FROM payments),0),0) AS n').get() as {n:number}).n,
    cancelled:(db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status='CANCELLED'").get() as {n:number}).n,
  }
  const stats=management?allStats:role==='DOCTOR'?{...allStats,revenue:0,outstanding:0,stockAlerts:0}:role==='NURSE'?{...allStats,revenue:0,outstanding:0,stockAlerts:0}:role==='LAB_TECHNICIAN'?{...allStats,patients:0,newPatients:0,todayAppointments:0,completed:0,doctors:0,stockAlerts:0,revenue:0,outstanding:0,cancelled:0}:role==='PHARMACIST'?{...allStats,patients:0,newPatients:0,todayAppointments:0,completed:0,doctors:0,pendingLabs:0,revenue:0,outstanding:0,cancelled:0}:{...allStats,patients:0,newPatients:0,todayAppointments:0,completed:0,doctors:0,pendingLabs:0,stockAlerts:0,cancelled:0}
  const dayKeys=Array.from({length:7},(_,i)=>{const day=new Date(`${todayKey}T00:00:00Z`);day.setUTCDate(day.getUTCDate()-6+i);return day.toISOString().slice(0,10)})
  const dayCounts=db.prepare("SELECT date(starts_at,'+5 hours','+30 minutes') label,COUNT(*) value FROM appointments WHERE date(starts_at,'+5 hours','+30 minutes') BETWEEN ? AND ? GROUP BY label").all(dayKeys[0],todayKey) as Row[]
  const appointmentsByDay=dayKeys.map(key=>({label:new Intl.DateTimeFormat('en-IN',{weekday:'short',timeZone:'UTC'}).format(new Date(`${key}T00:00:00Z`)),value:Number(dayCounts.find(row=>row.label===key)?.value||0)}))
  const patientsByDepartment=plainRows(db.prepare("SELECT d.name label,COUNT(*) value FROM patients p JOIN departments d ON d.id=p.department_id WHERE p.status='ACTIVE' GROUP BY d.id ORDER BY value DESC").all() as Row[]) as Point[]
  const appointmentStatuses=plainRows(db.prepare('SELECT status label,COUNT(*) value FROM appointments GROUP BY status ORDER BY value DESC').all() as Row[]) as Point[]
  const now=new Date(),monthKeys=Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-5+i,1));return {key:d.toISOString().slice(0,7),label:new Intl.DateTimeFormat('en-IN',{month:'short',timeZone:'UTC'}).format(d)}})
  const revenueRows=plainRows(db.prepare("SELECT strftime('%Y-%m',created_at,'+5 hours','+30 minutes') label,COALESCE(SUM(amount),0) value FROM payments GROUP BY label").all() as Row[]) as Point[]
  const revenueByMonth=monthKeys.map(month=>({label:month.label,value:Number(revenueRows.find(row=>row.label===month.key)?.value||0)}))
  const charts={appointmentsByDay,patientsByDepartment,appointmentStatuses,revenueByMonth}
  return <HmsApp user={{name:user.name,role:user.role,userId:user.userId}} data={{patients:plainRows(patients),appointments:plainRows(appointments),doctors:plainRows(doctors),departments:plainRows(departments),labOrders:plainRows(labOrders),labItems:plainRows(labItems),invoices:plainRows(invoices),medicineBatches:plainRows(medicineBatches),activities:plainRows(activities),vitals:plainRows(vitals),staff:plainRows(staff),stats,charts}} />
}
