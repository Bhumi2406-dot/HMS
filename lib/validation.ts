import { z } from 'zod'

export const patientInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  gender: z.enum(['Female', 'Male', 'Other']),
  phone: z.string().trim().min(8).max(20),
  email: z.union([z.string().email().max(160), z.literal('')]).optional(),
  dateOfBirth: z.union([z.string().date(), z.literal('')]).optional(),
  bloodGroup: z.string().max(4).optional(),
  address: z.string().max(500).optional(),
  emergencyName: z.string().max(120).optional(),
  emergencyPhone: z.string().max(20).optional(),
  allergies: z.string().max(1000).optional(),
  medicalHistory: z.string().max(4000).optional(),
  doctorId: z.string().optional(),
  departmentId: z.string().optional(),
})

export const appointmentInput = z.object({
  patientId: z.string().min(1), doctorId: z.string().min(1), departmentId: z.string().min(1),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(), type: z.string().max(40).default('CONSULTATION'),
  notes: z.string().max(1000).optional(),
}).refine((data) => new Date(data.endsAt) > new Date(data.startsAt), { message: 'End time must be after start time.' })

export const vitalInput = z.object({
  patientId: z.string().min(1), systolic: z.preprocess(emptyToUndefined,z.coerce.number().int().min(40).max(300).optional()),
  diastolic: z.preprocess(emptyToUndefined,z.coerce.number().int().min(20).max(200).optional()), heartRate: z.preprocess(emptyToUndefined,z.coerce.number().int().min(20).max(250).optional()),
  oxygen: z.preprocess(emptyToUndefined,z.coerce.number().min(50).max(100).optional()), temperature: z.preprocess(emptyToUndefined,z.coerce.number().min(25).max(45).optional()),
  respiratoryRate: z.preprocess(emptyToUndefined,z.coerce.number().int().min(1).max(100).optional()),
  weight: z.preprocess(emptyToUndefined,z.coerce.number().positive().max(500).optional()), height: z.preprocess(emptyToUndefined,z.coerce.number().positive().max(300).optional()), notes: z.string().max(1000).optional(),
})

export const staffInput = z.object({
  name:z.string().trim().min(2).max(100),
  email:z.string().trim().email().max(160),
  password:z.string().min(14).max(200),
  role:z.enum(['SUPER_ADMIN','HOSPITAL_ADMIN','DOCTOR','RECEPTIONIST','NURSE','LAB_TECHNICIAN','PHARMACIST','ACCOUNTANT']),
})

export const labOrderInput=z.object({patientId:z.string().min(1),category:z.string().trim().min(2).max(60),tests:z.string().trim().min(2).max(2000)})
export const labResultInput=z.object({itemId:z.string().min(1),value:z.string().trim().min(1).max(2000),unit:z.string().max(40).optional(),referenceRange:z.string().max(120).optional(),method:z.string().max(100).optional()})
export const medicineInput=z.object({name:z.string().trim().min(2).max(120),category:z.string().trim().min(2).max(80),minimumStock:z.coerce.number().int().min(0).max(100000),batchNumber:z.string().trim().min(2).max(80),expiryDate:z.string().date(),quantity:z.coerce.number().int().min(0).max(100000),purchasePrice:z.coerce.number().int().min(0).max(10000000),sellingPrice:z.coerce.number().int().min(0).max(10000000)})
export const invoiceInput=z.object({patientId:z.string().min(1),description:z.string().trim().min(2).max(200),quantity:z.coerce.number().int().min(1).max(10000),unitPrice:z.coerce.number().int().min(0).max(10000000),discount:z.coerce.number().int().min(0).max(10000000),tax:z.coerce.number().int().min(0).max(10000000)})
export const paymentInput=z.object({invoiceId:z.string().min(1),amount:z.coerce.number().int().min(1).max(100000000),method:z.enum(['CASH','CARD','UPI','BANK_TRANSFER']),reference:z.string().max(120).optional()})

function emptyToUndefined(value: unknown) { return value === '' ? undefined : value }
