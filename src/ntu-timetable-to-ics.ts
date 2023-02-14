class Exam {
    name: string
    room: string
    note: string
    dateStart: Date
    dateEnd: Date
}

class Lesson {
    name: string
    type: string
    room: string
    note: string
    timeStartMins: number
    timeEndMins: number
    day: number
    weeks: number[]

    _row: number
    _rowSpan: number
}

function importdom() {
    // load the source
    let textarea : HTMLTextAreaElement = document.getElementById("targetdom") as HTMLTextAreaElement;
    let doc = new DOMParser().parseFromString(textarea.value, "text/html");
    // define new semester start TODO: not hardcode this
    let semesterStart = new Date("2022-08-08T00:00:00Z");
    let recessWeek = new Date("2022-09-26T00:00:00Z");
    // download lessons and exams
    let lessons = getLessons(doc);
    let exams = getExams(doc);
    // generate calendar file
    let ics = lessonsToICS(lessons, exams, semesterStart, recessWeek);
    // download it
    download("ntu-timetable.ics", ics);
}

function lessonsToICS(lessons: Lesson[], exams: Exam[], semesterStart: Date, recessWeek: Date): string {
    // Make sure the semester and exam starts at Monday
    assertIsMonday(semesterStart);

    // header
    let ics: string = "BEGIN:VCALENDAR\r\n"
    ics += "VERSION:2.0\r\n";
    ics += "PRODID:-//hacksw/handcal//NONSGML v1.0//EN\r\n";
    let cnt = 0;

    lessons.forEach((lesson) => {
        // for each week
        lesson.weeks.forEach((week) => {
            let thisMonday = addDays(semesterStart, (week-1) * 7);

            // one week recess
            if ((thisMonday.getUTCMonth() == recessWeek.getUTCMonth() && thisMonday.getUTCDate() >= recessWeek.getUTCDate()) ||
                (thisMonday.getUTCMonth() > recessWeek.getUTCMonth())) {
                    thisMonday = addDays(thisMonday, 7);
            }

            let thisDayStart = addDays(thisMonday, lesson.day-1);
            let lecStart = new Date(thisDayStart);
            lecStart.setMinutes(lesson.timeStartMins);
            let lecEnd = new Date(thisDayStart);
            lecEnd.setMinutes(lesson.timeEndMins);

            ics += "BEGIN:VEVENT\r\n";
            ics += "UID:uid" + cnt.toString() + "@ntu.soptik.tech\r\n";
            ics += "DTSTAMP:" + formatDateTimeToICS(lecStart) + "\r\n";
            ics += "ORGANIZER;CN=NTU Timetable:MAILTO:ntu@soptik.tech\r\n";
            ics += "DTSTART:" + formatDateTimeToICS(lecStart) + "\r\n";
            ics += "DTEND:" + formatDateTimeToICS(lecEnd) + "\r\n";
            ics += "SUMMARY:" + lesson.name + " (" + lesson.type + ")\r\n";
            ics += "DESCRIPTION:" + lesson.note.replaceAll("\n","\\n") + "\r\n";
            ics += "LOCATION:" + lesson.room + "\r\n";
            ics += "END:VEVENT\r\n";

            cnt++;
        })
    });

    exams.forEach((exam) => {
        ics += "BEGIN:VEVENT\r\n";
        ics += "UID:uidEXAM" + cnt.toString() + "@ntu.soptik.tech\r\n";
        ics += "DTSTAMP:" + formatDateTimeToICS(exam.dateStart) + "\r\n";
        ics += "ORGANIZER;CN=NTU Timetable:MAILTO:ntu@soptik.tech\r\n";
        ics += "DTSTART:" + formatDateTimeToICS(exam.dateStart) + "\r\n";
        ics += "DTEND:" + formatDateTimeToICS(exam.dateEnd) + "\r\n";
        ics += "SUMMARY:" + exam.name + " (Exam)\r\n";
        ics += "DESCRIPTION:" + exam.note.replaceAll("\n","\\n") + "\r\n";
        ics += "LOCATION:" + exam.room + "\r\n";
        ics += "END:VEVENT\r\n";

        cnt++;
    });

    // footer
    ics += "END:VCALENDAR\r\n";

    return ics;
}

// Get the table
function getLessons(doc: Document): Lesson[] {
    let timetable = doc.getElementsByTagName("table")[1]

    let result: Lesson[] = [];

    // Parse timetable
    {
        let timetableRows: HTMLTableRowElement[] = Array.from(timetable.getElementsByTagName("tr"));
        // skip first row: it's heading
        for(let i = 1; i < timetableRows.length; i++) {
            let row = timetableRows[i];
            let timetableColumns: HTMLTableCellElement[] = Array.from(row.getElementsByTagName("td"));
            // skip first column: it's the time
            for(let j = 1; j < timetableColumns.length; j++) {
                let col = timetableColumns[j];

                // If a col has rowspan defined, it's a lesson
                if (col.hasAttribute("rowspan")) {
                    let content: string = col.children[0].innerHTML;
                    let rowspan: number = parseInt(col.getAttribute("rowspan"));
                    
                    let newLesson = parseLessonFromText(content, rowspan, result, i, j);
                    result.push(newLesson);
                }
            }
        }
    }

    return result;
}

function parseLessonFromText(content: string, rowspan: number, previousLessons: Lesson[], rowId: number, colId: number): Lesson {
    content = content.replaceAll("<BR>","<br>");

    let parts = content.split("<br>");
    let name = parts[0];
    let time = parts[1];
    let weeks = parts[2]; // might be empty

    let lessonDay = colId;
    // every lesson in previous days, that starts before us and lasts at least at least till after our lecture,
    // will hide one col index from us. So we must add it this way.
    let hiddenCols = previousLessons.filter(l => l.day <= colId && l._row < rowId && l._rowSpan > (rowId - l._row)).length;
    lessonDay += hiddenCols;

    let courseName = name.split(' ')[0];
    let courseType = name.split(' ')[1];
    console.log(courseName + " (" + courseType + ") >>> " + colId.toString() + " + " + hiddenCols.toString());
    let room = name.split(' ').reverse()[0];
    let timeStartStr = time.split('to')[0];
    let timeStart = parseInt(timeStartStr.substring(0,2)) * 60 + parseInt(timeStartStr.substring(2,4));
    let timeEndStr = time.split('to')[1].replaceAll("-","");
    let timeEnd = parseInt(timeEndStr.substring(0,2)) * 60 + parseInt(timeEndStr.substring(2,4));
    let week: number[] = [];
    if (weeks.trim() == "") {
        for(let i = 1; i <= 13; i++) week.push(i);
    } else if (weeks.search("-") != -1) {
        let fromToW = weeks.replaceAll("Wk","").replaceAll(";","").split("-");
        for(let i = parseInt(fromToW[0]); i <= parseInt(fromToW[1]); i++) week.push(i);
    } else {
        week = weeks.replaceAll("Wk","").replaceAll(";","").split(",").map(w => parseInt(w));
    }

    let result: Lesson = new Lesson();
    result.name = courseName;
    result.type = courseType;
    result.room = room;
    result.note = content.replaceAll("<br>", "\n");
    result.timeStartMins = timeStart;
    result.timeEndMins = timeEnd;
    result.day = lessonDay;
    result.weeks = week;

    result._row = rowId;
    result._rowSpan = rowspan;

    return result;
}

function getExams(doc: Document): Exam[] {
    let examtable = doc.getElementsByTagName("table")[2]

    let result: Exam[] = [];

    let rows = examtable.getElementsByTagName("tr");
    for(let i = 2; i < rows.length-1; i++) {
        let row = rows[i];
        let cols = row.children;

        let courseCode = cols[1].textContent.trim();
        let courseName = cols[2].textContent.trim();
        let examTime = cols[5].textContent.trim();
        let examDateStart: Date;
        let examDateEnd: Date;

        if (examTime == "Not Applicable") {
            continue;
        } else {
            examDateStart = new Date(examTime.split(" ")[0].replaceAll("-", " ") + " GMT");
            examDateEnd = new Date(examTime.split(" ")[0].replaceAll("-", " ") + " GMT");
            let time = examTime.split(" ")[1];
            let timeStartStr = time.split('to')[0];
            let timeStart = parseInt(timeStartStr.substring(0,2)) * 60 + parseInt(timeStartStr.substring(2,4));
            let timeEndStr = time.split('to')[1].replaceAll("-","");
            let timeEnd = parseInt(timeEndStr.substring(0,2)) * 60 + parseInt(timeEndStr.substring(2,4));
            examDateStart.setMinutes(timeStart);
            examDateEnd.setMinutes(timeEnd);

            let e: Exam = new Exam();

            e.name = courseCode;
            e.room = "";
            e.note = courseName + " exam, starting at " + timeStartStr;
            e.dateStart = examDateStart;
            e.dateEnd = examDateEnd;
            console.log(e);

            result.push(e);
        }
    }

    return result;
}

// UTILITIES
function assertIsMonday(dateToCheck: Date): asserts dateToCheck {
    if (dateToCheck.getDay() != 1) {
        throw new RangeError("Date doesn't start at Monday.")
    }
}
function addDays(date: Date, days: number): Date {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
function addHours(date: Date, hours: number): Date {
    var result = new Date(date);
    result.setUTCHours(result.getUTCHours() + hours);
    return result;
}
function formatDateTimeToICS(date) {
    date = addHours(date, -8); // compensate for UTC vs Singapore time
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hour = pad(date.getUTCHours());
    const minute = pad(date.getUTCMinutes());
    const second = pad(date.getUTCSeconds());
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
  }
  
function pad(i) {
    return i < 10 ? `0${i}` : `${i}`;
  }
function download(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
  
    element.style.display = 'none';
    document.body.appendChild(element);
  
    element.click();
  
    document.body.removeChild(element);
  }
