// Nigerian 5-point grading scale.
export function gradeFor(score) {
  if (score >= 70) return { letter: 'A', point: 5 };
  if (score >= 60) return { letter: 'B', point: 4 };
  if (score >= 50) return { letter: 'C', point: 3 };
  if (score >= 45) return { letter: 'D', point: 2 };
  if (score >= 40) return { letter: 'E', point: 1 };
  return { letter: 'F', point: 0 };
}

/** rows: [{ units, score }] -> GPA rounded to 2 dp, or null when there is nothing to count. */
export function gpa(rows) {
  let units = 0, points = 0;
  for (const r of rows) {
    if (r.score == null) continue;
    units += r.units;
    points += r.units * gradeFor(r.score).point;
  }
  return units ? Math.round((points / units) * 100) / 100 : null;
}

export function classOfDegree(cgpa) {
  if (cgpa == null) return '';
  if (cgpa >= 4.5) return 'First Class';
  if (cgpa >= 3.5) return 'Second Class Upper';
  if (cgpa >= 2.4) return 'Second Class Lower';
  if (cgpa >= 1.5) return 'Third Class';
  return 'Pass';
}
