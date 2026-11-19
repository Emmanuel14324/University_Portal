/**
 * Seed script — creates the first SUPER_ADMIN user and sample academic data.
 * Run once: node scripts/seed.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ── Load .env.local manually ────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const envLines = readFileSync(envPath, "utf-8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim().replace(/^"(.*)"$/, "$1");
  if (!process.env[key]) process.env[key] = value;
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set in .env.local");
  process.exit(1);
}

// ── Minimal inline schemas (avoids Next.js / server-only imports) ───────────

const UserSchema = new mongoose.Schema(
  { email: String, passwordHash: String, fullName: String, isActive: { type: Boolean, default: true } },
  { timestamps: true },
);
const UserRoleSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  role: String,
  assignedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  assignedAt: { type: Date, default: Date.now },
});
const ProgrammeSchema = new mongoose.Schema(
  { code: String, name: String, award: String, department: String, durationYears: Number, isActive: { type: Boolean, default: true } },
  { timestamps: true },
);
const CourseSchema = new mongoose.Schema(
  { code: String, name: String, department: String, creditUnits: Number, isActive: { type: Boolean, default: true } },
  { timestamps: true },
);
const SemesterSchema = new mongoose.Schema(
  {
    academicYear: String, name: String, startsOn: Date, endsOn: Date,
    registrationOpensAt: { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null },
    status: { type: String, default: "UPCOMING" },
  },
  { timestamps: true },
);

const User = mongoose.models.User ?? mongoose.model("User", UserSchema);
const UserRole = mongoose.models.UserRole ?? mongoose.model("UserRole", UserRoleSchema);
const Programme = mongoose.models.Programme ?? mongoose.model("Programme", ProgrammeSchema);
const Course = mongoose.models.Course ?? mongoose.model("Course", CourseSchema);
const Semester = mongoose.models.Semester ?? mongoose.model("Semester", SemesterSchema);

// ── Seed data ────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "admin@stjude.ac.ug";
const ADMIN_PASSWORD = "Admin@StJude2026!";
const ADMIN_NAME = "System Administrator";

async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log("Connected.\n");

  // 1. Super-admin user
  let admin = await User.findOne({ email: ADMIN_EMAIL });
  if (admin) {
    console.log(`Admin user already exists: ${ADMIN_EMAIL}`);
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    admin = await User.create({ email: ADMIN_EMAIL, passwordHash, fullName: ADMIN_NAME });
    await UserRole.create({ userId: admin._id, role: "SUPER_ADMIN", assignedBy: null });
    console.log("✓ Super-admin created");
    console.log(`  Email   : ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log("  ⚠  Change this password after first login.\n`");
  }

  // 2. Sample programme
  let programme = await Programme.findOne({ code: "BSC-CS" });
  if (!programme) {
    programme = await Programme.create({
      code: "BSC-CS",
      name: "Bachelor of Science in Computer Science",
      award: "BSc",
      department: "Computer Science",
      durationYears: 3,
      isActive: true,
    });
    console.log("✓ Sample programme created: BSC-CS");
  } else {
    console.log("Programme BSC-CS already exists, skipping.");
  }

  // 3. Sample courses
  const sampleCourses = [
    { code: "CS101", name: "Introduction to Programming", department: "Computer Science", creditUnits: 3 },
    { code: "CS102", name: "Data Structures & Algorithms", department: "Computer Science", creditUnits: 3 },
    { code: "CS201", name: "Database Systems", department: "Computer Science", creditUnits: 3 },
    { code: "MATH101", name: "Calculus I", department: "Mathematics", creditUnits: 3 },
  ];
  for (const c of sampleCourses) {
    const exists = await Course.findOne({ code: c.code });
    if (!exists) {
      await Course.create({ ...c, isActive: true });
      console.log(`✓ Course created: ${c.code}`);
    }
  }

  // 4. Sample semester
  let semester = await Semester.findOne({ academicYear: "2026/2027", name: "Semester I" });
  if (!semester) {
    semester = await Semester.create({
      academicYear: "2026/2027",
      name: "Semester I",
      startsOn: new Date("2026-09-01"),
      endsOn: new Date("2027-01-31"),
      registrationOpensAt: new Date("2026-08-01"),
      registrationClosesAt: new Date("2026-09-15"),
      status: "REGISTRATION_OPEN",
    });
    console.log("✓ Sample semester created: 2026/2027 Semester I");
  } else {
    console.log("Semester 2026/2027 Semester I already exists, skipping.");
  }

  console.log("\n✅ Seed complete. You can now log in at http://localhost:3000/login");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
