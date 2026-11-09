/**
 * Demo content for `npm run seed`. Text is aligned with the System 1 rules in
 * src/lib/ask/system1/rules.ts (3.0 GPA minimum, years 2-4, and the exact
 * office names used by routePolicy). The two organizations have deliberately
 * different facts, so any cross-tenant leak would be obvious.
 *
 * Plain ASCII only: the standard PDF fonts can't encode most Unicode.
 */

export type SeedDocument = { fileName: string; title: string; pages: string[] };
export type SeedOrganization = { name: string; slug: string; ownerEmail: string; ownerName: string; documents: SeedDocument[] };

export const SEED_ORGANIZATIONS: SeedOrganization[] = [
  {
    name: "Northbridge University",
    slug: "northbridge",
    ownerEmail: "admin@northbridge.example",
    ownerName: "Northbridge Admin",
    documents: [
      {
        fileName: "Northbridge Merit Scholarship Guide.pdf",
        title: "Merit Scholarship Guide 2026-2027",
        pages: [
          `Northbridge University Merit Scholarship Guide, 2026-2027

Overview
The Northbridge Merit Scholarship rewards students who have shown strong and consistent academic achievement. The scholarship is administered by the Financial Aid Office.

Award amount
The Merit Scholarship pays $2,500 per semester. It can be renewed for up to four semesters in total, for a maximum of $10,000.

Eligibility requirements
To be eligible, a student must meet BOTH of the following conditions:
1. A cumulative GPA of 3.0 or higher on a 4.0 scale.
2. Current enrollment in the second, third, or fourth year of study (sophomore, junior, or senior standing).

First-year students (freshmen) are not eligible for the Merit Scholarship. They may apply once they reach their second year, provided their GPA is 3.0 or higher. Students in a fifth year or beyond are not eligible.

A student who meets only one of the two conditions is not eligible.`,
          `Application process
Applications are submitted through the Financial Aid Office student portal.

Deadline: Applications must be received by March 15. Late applications are not considered.

Required documents:
- An official transcript showing the cumulative GPA.
- A personal statement of no more than 500 words.
- One reference letter from a faculty member.

Decisions are emailed to applicants by April 30.

Renewal
Recipients must keep a cumulative GPA of 3.0 or higher at the end of each semester to renew the award. A recipient whose GPA falls below 3.0 loses the scholarship for the following semester and may reapply once the GPA is restored.

Contact
Financial Aid Office, Room 120, Hamilton Hall. Office hours are Monday to Friday, 9:00 AM to 4:30 PM.`,
        ],
      },
      {
        fileName: "Northbridge Student Policy Handbook.pdf",
        title: "Student Policy Handbook",
        pages: [
          `Northbridge University Student Policy Handbook

Section 1: Academic Standards Policy
Responsible office: Office of the Registrar

The Office of the Registrar handles grade appeals, transcript requests, course withdrawals, and academic standing.

Academic probation: A student whose cumulative GPA falls below 2.0 is placed on academic probation for one semester. Students on probation must meet with an academic advisor before registering for courses.

Grade appeals must be filed with the Office of the Registrar within 30 days of the grade being posted.`,
          `Section 2: Residence and Housing Policy
Responsible office: Housing Services

Housing Services manages on-campus housing applications, room assignments, room change requests, and maintenance requests.

Housing applications for the fall semester open on February 1. Room change requests are accepted during the first three weeks of each semester. Maintenance issues should be reported through the Housing Services portal; urgent issues such as flooding are handled within 4 hours.

Questions about any residence or housing policy should be directed to Housing Services, located in Carver Hall.`,
          `Section 3: Student Conduct Policy
Responsible office: Dean of Students

The Dean of Students oversees the Student Conduct Policy, including academic integrity, plagiarism, harassment, and other misconduct.

Plagiarism: An instructor who suspects plagiarism must report it to the Dean of Students within 14 days. The student is notified in writing and may respond within 7 days. A first offense usually results in a failing grade on the assignment and a mandatory academic integrity workshop.

Students who wish to report misconduct may contact the Dean of Students directly or submit a confidential report online.`,
          `Section 4: Health and Wellbeing Policy
Responsible office: Student Health Services

Student Health Services provides medical care, counseling, and disability accommodations.

Medical leave: A student may request a medical leave of absence for up to two semesters. Requests are submitted to Student Health Services with documentation from a licensed provider. Students returning from medical leave must complete a return-to-study meeting.

Counseling appointments are free for all enrolled students.`,
          `Section 5: Financial Aid and Scholarships Policy
Responsible office: Financial Aid Office

The Financial Aid Office manages scholarships, grants, student loans, tuition payment plans, and financial aid appeals.

Tuition for each semester is due by the first day of classes. Students may enroll in a monthly payment plan for a $40 fee per semester. Financial aid appeals must be submitted within 21 days of the aid decision.

Information about the Merit Scholarship is in the separate Merit Scholarship Guide.`,
        ],
      },
      {
        fileName: "Northbridge Residence Life Guide.pdf",
        title: "Residence Life Guide",
        pages: [
          `Northbridge University Residence Life Guide

Move-in
Fall move-in for new residents is on August 24. Returning residents may move in from August 26. Each resident receives a key card at the Housing Services desk in Carver Hall.

Quiet hours
Quiet hours are 10:00 PM to 8:00 AM Sunday through Thursday, and midnight to 9:00 AM on Friday and Saturday. During final exams, quiet hours apply 24 hours a day.`,
          `Guests
Residents may host overnight guests for a maximum of 3 nights per month. Guests must be registered with the front desk and accompanied by their host at all times.

Pets
Pets are not permitted in residence halls, except fish in tanks of 10 gallons or less. Service animals and approved emotional support animals are allowed.

Room inspections
Housing Services inspects rooms at the end of each semester. Residents are charged for damage beyond normal wear.`,
        ],
      },
    ],
  },
  {
    name: "Lakeside College",
    slug: "lakeside",
    ownerEmail: "admin@lakeside.example",
    ownerName: "Lakeside Admin",
    documents: [
      {
        fileName: "Lakeside Achievement Award.pdf",
        title: "Lakeside Achievement Award",
        pages: [
          `Lakeside College Achievement Award

The Lakeside Achievement Award is an annual scholarship of $1,800 per academic year, paid in two equal installments.

Eligibility
Students must have a cumulative GPA of at least 3.0 on a 4.0 scale AND be in their second, third, or fourth year of study. First-year students are not eligible.

How to apply
Submit the online application to the Lakeside Financial Aid Office by April 30. Include a one-page essay describing a community project you have led.`,
          `Selection and payment
Award recipients are notified by June 15. The first installment is applied to fall tuition and the second to spring tuition.

Renewal
The award may be renewed each year as long as the student maintains a GPA of 3.0 or higher and remains enrolled full time.

Contact the Financial Aid Office at the Lakeside Student Center, second floor.`,
        ],
      },
      {
        fileName: "Lakeside Academic Integrity Policy.pdf",
        title: "Academic Integrity & Conduct Policy",
        pages: [
          `Lakeside College Academic Integrity and Conduct Policy

Responsible office: Dean of Students

Plagiarism and cheating
Instructors must report suspected plagiarism or cheating to the Dean of Students within 10 business days of discovery. The student receives written notice and may meet with the Dean of Students before any sanction is decided.

Sanctions
A first violation results in a written warning and a zero on the assignment. A second violation results in failure of the course. A third violation may result in suspension.`,
          `Appeals
Students may appeal a conduct decision within 7 days by submitting a written appeal to the Dean of Students. Appeals are reviewed by a panel of two faculty members and one student representative.

Confidentiality
Conduct records are confidential and are not shared with other institutions without the student's written consent.`,
        ],
      },
      {
        fileName: "Lakeside Library Guide.pdf",
        title: "Library & Study Spaces Guide",
        pages: [
          `Lakeside College Library and Study Spaces Guide

Opening hours
The Harbor Library is open from 7:00 AM to midnight Monday through Friday, and 10:00 AM to 8:00 PM on weekends.

Group study rooms
Group study rooms can be booked for up to 2 hours per day through the library website. Rooms hold up to 6 people.

Borrowing
Students may borrow up to 15 books at a time for 3 weeks. Late returns cost $0.25 per day per item.`,
        ],
      },
    ],
  },
];

/** Port the demo host page is served on by `npm run demo`. */
export const DEMO_ORIGIN = "http://localhost:5500";
