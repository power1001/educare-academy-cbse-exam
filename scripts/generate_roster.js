const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Generate 500 unguessable roll numbers and passwords
// Roll Number prefix: 26CBSEBRD
// Followed by 3 unguessable characters/digits (from 32 unambiguous chars: 2-9, A-Z excluding 0, O, 1, I)
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASS_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASS_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASS_DIGITS = '23456789';
const PASS_SPECIAL = '@#&%';

function generate3CharUnguessable(existingSet) {
  while (true) {
    const bytes = crypto.randomBytes(3);
    let code = '';
    for (let i = 0; i < 3; i++) {
      code += CHARS[bytes[i] % CHARS.length];
    }
    const roll = '26CBSEBRD' + code;
    if (!existingSet.has(roll)) {
      existingSet.add(roll);
      return roll;
    }
  }
}

function generateUnguessablePassword() {
  const u = PASS_UPPER[crypto.randomInt(PASS_UPPER.length)];
  const l1 = PASS_LOWER[crypto.randomInt(PASS_LOWER.length)];
  const l2 = PASS_LOWER[crypto.randomInt(PASS_LOWER.length)];
  const d1 = PASS_DIGITS[crypto.randomInt(PASS_DIGITS.length)];
  const d2 = PASS_DIGITS[crypto.randomInt(PASS_DIGITS.length)];
  const s = PASS_SPECIAL[crypto.randomInt(PASS_SPECIAL.length)];
  const ALL = PASS_UPPER + PASS_LOWER + PASS_DIGITS + PASS_SPECIAL;
  const r1 = ALL[crypto.randomInt(ALL.length)];
  const r2 = ALL[crypto.randomInt(ALL.length)];
  const arr = [u, l1, l2, d1, d2, s, r1, r2];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

const firstNames = [
  'Aarav', 'Aditi', 'Aditya', 'Akash', 'Amit', 'Ananya', 'Anik', 'Aniket', 'Anjali', 'Anmol',
  'Ansh', 'Anushka', 'Aryan', 'Ayush', 'Deepak', 'Dev', 'Diya', 'Gaurav', 'Harsh', 'Ishaan',
  'Karan', 'Khushi', 'Kritika', 'Manish', 'Mayank', 'Meera', 'Mohit', 'Muskan', 'Naman', 'Neha',
  'Nikhil', 'Nisha', 'Palak', 'Pooja', 'Pranav', 'Prashant', 'Priya', 'Rahul', 'Rishabh', 'Ritesh',
  'Riya', 'Rohan', 'Rohit', 'Sakshi', 'Sameer', 'Shivam', 'Shruti', 'Siddharth', 'Sneha', 'Tanvi',
  'Tanya', 'Varun', 'Vikas', 'Vishal', 'Yash', 'Kavya', 'Alok', 'Sumit', 'Sunil', 'Komal'
];

const lastNames = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Mishra', 'Pandey', 'Yadav', 'Patel', 'Jha',
  'Tiwari', 'Das', 'Roy', 'Choudhary', 'Dubey', 'Sinha', 'Chauhan', 'Saxena', 'Bhardwaj', 'Rajput',
  'Shukla', 'Soni', 'Thakur', 'Tripathi', 'Aggarwal', 'Bhatt', 'Bose', 'Chatterjee', 'Dutta', 'Ghosh',
  'Garg', 'Kapoor', 'Malhotra', 'Mehta', 'Nath', 'Prasad', 'Rao', 'Reddy', 'Sahni', 'Sen'
];

const usedRolls = new Set();
const students = [];

for (let i = 1; i <= 500; i++) {
  const fn = firstNames[(i * 17 + 11) % firstNames.length];
  const ln = lastNames[(i * 23 + 37) % lastNames.length];
  const roll = generate3CharUnguessable(usedRolls);
  const pass = generateUnguessablePassword();
  students.push({
    serial: i,
    name: fn + ' ' + ln,
    roll: roll,
    password: pass,
    class: 'Class 10 CBSE',
    status: 'ACTIVE'
  });
}

const baseDir = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(baseDir, 'students_roster.json'), JSON.stringify(students, null, 2), 'utf-8');

// Write CSV
let csv = 'Serial,Name,Roll Number,Password,Class,Status\n';
students.forEach(s => {
  csv += `${s.serial},"${s.name}",${s.roll},${s.password},${s.class},${s.status}\n`;
});
fs.writeFileSync(path.join(baseDir, 'STUDENT_CREDENTIALS_LIST.csv'), csv, 'utf-8');

// Write Markdown table
let md = `# EDUCARE ACADEMY - CBSE CLASS 10TH OFFICIAL STUDENT CREDENTIALS\n\n`;
md += `> **Total Registered Students:** 500 Students  \n`;
md += `> **Format:** Roll Number: \`26CBSEBRD---\` (3 Unguessable Characters) | Password: 8-char Unguessable Cryptographic Token  \n`;
md += `> **Teacher Helpline & WhatsApp:** +91 8448467381  \n\n`;
md += `| Serial | Student Name | Roll Number | Password | Class | Status |\n`;
md += `|:---:|:---|:---:|:---:|:---:|:---:|\n`;
students.forEach(s => {
  md += `| ${s.serial} | ${s.name} | \`${s.roll}\` | \`${s.password}\` | ${s.class} | ${s.status} |\n`;
});
fs.writeFileSync(path.join(baseDir, 'STUDENT_CREDENTIALS_LIST.md'), md, 'utf-8');

console.log('Successfully generated 500 students with unique roll numbers 26CBSEBRD--- and unguessable passwords.');
console.log('Sample student 1:', students[0]);
console.log('Sample student 2:', students[1]);
console.log('Sample student 500:', students[499]);
