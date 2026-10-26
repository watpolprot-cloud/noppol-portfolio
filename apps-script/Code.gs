/**
 * ระบบติดตามงาน ครูนพพล ภาณุสุวัฒน์
 * -----------------------------------------------------------------------------
 * Google Sheet นี้เป็นที่เก็บงานและกำหนดส่งทั้งหมดของครู
 *  - หน้าเว็บ tasks.html บนเว็บพอร์ตโฟลิโอดึงข้อมูลผ่าน doGet()
 *    ได้เฉพาะงานที่ติ๊ก "แสดงบนเว็บ" และเฉพาะคอลัมน์ที่อนุญาตเท่านั้น
 *    (คอลัมน์ "แหล่งที่มา" และ "บันทึกส่วนตัว" ไม่ถูกส่งออกไปไม่ว่ากรณีใด)
 *  - ส่งอีเมลแจ้งเตือนทุกเช้าเมื่อมีงานเลยกำหนดหรือใกล้กำหนด
 *    และส่งสรุปงาน 14 วันข้างหน้าทุกวันจันทร์
 *
 * ติดตั้ง (ทำครั้งเดียว)
 *  1. วางโค้ดนี้ใน ส่วนขยาย > Apps Script แล้วบันทึก
 *  2. เลือกฟังก์ชัน setup แล้วกด เรียกใช้ (Run) และอนุญาตสิทธิ์
 *  3. การทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป
 *     ดำเนินการในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 *
 * @OnlyCurrentDoc
 */

const CONFIG = {
  TASK_SHEET: 'งาน',
  SETTINGS_SHEET: 'ตั้งค่า',
  TZ: 'Asia/Bangkok',
  WEB_PAGE_URL: 'https://watpolprot-cloud.github.io/noppol-portfolio/tasks.html',
  REMINDER_HOUR: 6,          // ส่งอีเมลช่วง 06.00–07.00 น.
  WEEKLY_DAYS: 14,           // สรุปวันจันทร์ครอบคลุมกี่วันข้างหน้า
  CACHE_KEY: 'public-tasks-v1',
  CACHE_SECONDS: 60,         // หน้าเว็บเห็นข้อมูลใหม่ภายใน 1 นาที (แก้ในชีตแล้วล้างทันที)
  FORMAT_ROWS: 1000,         // จำนวนแถวที่ใส่รูปแบบและตัวเลือกไว้ล่วงหน้า
  HEADER_NOTE: 'หัวคอลัมน์ของระบบติดตามงาน'
};

const COLUMNS = [
  { key: 'title',    header: 'งาน',                       width: 300 },
  { key: 'due',      header: 'กำหนดส่ง',                  width: 130 },
  { key: 'time',     header: 'เวลา',                      width: 120 },
  { key: 'status',   header: 'สถานะ',                     width: 110 },
  { key: 'priority', header: 'ความเร่งด่วน',               width: 110 },
  { key: 'category', header: 'หมวดหมู่',                  width: 140 },
  { key: 'public',   header: 'แสดงบนเว็บ',                width: 100 },
  { key: 'detail',   header: 'รายละเอียด (แสดงบนเว็บ)',    width: 320 },
  { key: 'link',     header: 'ลิงก์ (แสดงบนเว็บ)',         width: 220 },
  { key: 'source',   header: 'แหล่งที่มา (ไม่ขึ้นเว็บ)',     width: 260 },
  { key: 'note',     header: 'บันทึกส่วนตัว (ไม่ขึ้นเว็บ)',  width: 260 }
];

const STATUS = { TODO: 'ยังไม่เริ่ม', DOING: 'กำลังทำ', DONE: 'เสร็จแล้ว', CANCELLED: 'ยกเลิก' };
const STATUS_LIST = [STATUS.TODO, STATUS.DOING, STATUS.DONE, STATUS.CANCELLED];
const PRIORITY_URGENT = 'เร่งด่วน';
const PRIORITY_LIST = [PRIORITY_URGENT, 'ปกติ'];
const CATEGORY_LIST = ['การสอน', 'ครูที่ปรึกษา', 'งานโรงเรียน', 'กิจกรรม/คณะสี', 'วิชาชีพ/ประเมิน', 'เว็บไซต์', 'อื่น ๆ'];

const SETTINGS = [
  { key: 'email',     label: 'อีเมลรับการแจ้งเตือน',      def: '',           help: 'ใส่ได้หลายอีเมล คั่นด้วยเครื่องหมายจุลภาค (,)' },
  { key: 'enabled',   label: 'เปิดการแจ้งเตือนทางอีเมล',  def: true,         help: 'เอาเครื่องหมายถูกออกเพื่อหยุดส่งอีเมลทั้งหมด', checkbox: true },
  { key: 'daysAhead', label: 'แจ้งเตือนล่วงหน้า (วัน)',     def: 3,            help: 'ส่งอีเมลตอนเช้าเมื่อมีงานที่ครบกำหนดภายในจำนวนวันนี้ (0–30)' },
  { key: 'weekly',    label: 'สรุปงาน 14 วันทุกวันจันทร์', def: true,         help: 'ส่งสรุปทุกเช้าวันจันทร์ แม้ไม่มีงานใกล้กำหนด', checkbox: true },
  { key: 'term',      label: 'ภาคเรียน',                  def: '2/2569',     help: 'แสดงบนหน้าเว็บ' },
  { key: 'termStart', label: 'วันจันทร์ของสัปดาห์ที่ 1',    def: '2026-10-26', help: 'ใช้นับสัปดาห์ของภาคเรียน (พิมพ์ วัน/เดือน/ปี)', date: true },
  { key: 'termEnd',   label: 'วันสุดท้ายของภาคเรียน',      def: '2027-02-26', help: 'วันสุดท้ายของการสอบปลายภาค', date: true }
];

const HOW_TO = [
  'วิธีใช้โดยย่อ',
  '1 แถว = 1 งาน พิมพ์ชื่องานในคอลัมน์ "งาน" แถวไหนไม่มีชื่องานระบบจะข้ามไป',
  'กำหนดส่ง: พิมพ์ วัน/เดือน/ปี เช่น 30/10/2569 ได้เลย ระบบจะแปลงเป็นปี ค.ศ. ให้เอง (ชีตแสดงเป็น ค.ศ. แต่เว็บและอีเมลแสดงเป็น พ.ศ.)',
  'ติ๊ก "แสดงบนเว็บ" เฉพาะงานที่เปิดเผยได้ เว็บจะเห็นเพียง งาน กำหนดส่ง เวลา สถานะ ความเร่งด่วน หมวดหมู่ รายละเอียด และลิงก์',
  'ห้ามใส่ชื่อหรือข้อมูลรายคนของนักเรียนในคอลัมน์ที่ขึ้นเว็บ ให้ใส่ในคอลัมน์ "บันทึกส่วนตัว" แทน',
  'คอลัมน์ "แหล่งที่มา" และ "บันทึกส่วนตัว" ไม่ขึ้นเว็บเสมอ แต่จะอยู่ในอีเมลแจ้งเตือนถึงครู',
  'ทำเสร็จแล้วเปลี่ยนสถานะเป็น "เสร็จแล้ว" ไม่ต้องลบแถว',
  'เมนู "ระบบติดตามงาน" ด้านบน: ดูข้อมูลที่จะแสดงบนเว็บ และส่งอีเมลทดสอบ',
  'อย่าเปลี่ยนชื่อชีต "งาน" "ตั้งค่า" และหัวคอลัมน์ในแถวที่ 1'
];

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];


/* =============================================================================
 * เมนูและการติดตั้ง
 * ========================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบติดตามงาน')
    .addItem('ดูข้อมูลที่จะแสดงบนเว็บ', 'previewPublicData')
    .addItem('ส่งอีเมลทดสอบตอนนี้', 'sendTestEmail')
    .addSeparator()
    .addItem('ตั้งค่าใหม่ / ซ่อมระบบ', 'setup')
    .addToUi();
}

/** สร้างชีต หัวคอลัมน์ ตัวเลือก รูปแบบ และตั้งเวลาส่งอีเมล (รันซ้ำได้ ข้อมูลเดิมไม่หาย) */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CONFIG.TZ);
  ss.setSpreadsheetLocale('th_TH');
  setupSettingsSheet_(ss);
  const sheet = setupTaskSheet_(ss, readSettings_().daysAhead);
  installTriggers_();
  clearCache_();
  ss.setActiveSheet(sheet);
  const msg = 'ตั้งค่าเสร็จแล้ว: ชีต "' + CONFIG.TASK_SHEET + '" และ "' + CONFIG.SETTINGS_SHEET +
    '" พร้อมใช้ และตั้งเวลาส่งอีเมลแจ้งเตือนทุกวันช่วง 06.00–07.00 น.';
  ss.toast(msg, 'ระบบติดตามงาน', 10);
  console.log(msg);
}

function setupTaskSheet_(ss, daysAhead) {
  let sh = ss.getSheetByName(CONFIG.TASK_SHEET);
  if (!sh) {
    // ไฟล์ใหม่มีชีตว่าง 1 แผ่น (ชีต1) ให้ใช้แผ่นนั้นเลย ไม่สร้างเพิ่ม
    const others = ss.getSheets().filter(function (s) { return s.getName() !== CONFIG.SETTINGS_SHEET; });
    const blank = others.length === 1 && others[0].getLastRow() === 0 && others[0].getLastColumn() === 0;
    sh = blank ? others[0].setName(CONFIG.TASK_SHEET) : ss.insertSheet(CONFIG.TASK_SHEET, 0);
  }

  // หัวคอลัมน์: แถวว่างใส่ครบทุกคอลัมน์ · ถ้ามีอยู่แล้วเติมเฉพาะคอลัมน์ที่ขาดต่อท้าย
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const current = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (current.every(function (h) { return String(h).trim() === ''; })) {
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return c.header; })]);
  } else {
    const have = headerIndex_(current);
    const missing = COLUMNS.filter(function (c) { return have[c.key] === undefined; });
    if (missing.length) {
      sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing.map(function (c) { return c.header; })]);
    }
  }
  const width = sh.getLastColumn();
  const idx = headerIndex_(sh.getRange(1, 1, 1, width).getValues()[0]);

  if (sh.getMaxRows() < CONFIG.FORMAT_ROWS) sh.insertRowsAfter(sh.getMaxRows(), CONFIG.FORMAT_ROWS - sh.getMaxRows());
  const rows = CONFIG.FORMAT_ROWS - 1;
  const col = function (key) { return sh.getRange(2, idx[key] + 1, rows, 1); };
  const letter = function (key) { return '$' + columnLetter_(idx[key] + 1) + '2'; };

  sh.getRange(1, 1, 1, width)
    .setBackground('#4A2C8F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 40);
  sh.setFrozenRows(1);
  COLUMNS.forEach(function (c) { sh.setColumnWidth(idx[c.key] + 1, c.width); });
  sh.getRange(2, 1, rows, width).setVerticalAlignment('top');

  col('title').setWrap(true);
  col('due').setNumberFormat('d mmm yyyy').setHorizontalAlignment('left').setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText('พิมพ์วันที่แบบ วัน/เดือน/ปี เช่น 30/10/2569 (ปี พ.ศ. หรือ ค.ศ. ก็ได้) หรือดับเบิลคลิกเพื่อเลือกจากปฏิทิน')
      .build());
  col('time').setNumberFormat('@');
  col('status').setDataValidation(listRule_(STATUS_LIST, false, 'เลือกสถานะของงาน'));
  col('priority').setDataValidation(listRule_(PRIORITY_LIST, false, 'เลือก "เร่งด่วน" สำหรับงานที่ต้องทำก่อน'));
  col('category').setDataValidation(listRule_(CATEGORY_LIST, true, 'เลือกหมวดหมู่ หรือพิมพ์หมวดใหม่เองได้'));
  col('public').setHorizontalAlignment('center').setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox()
      .setHelpText('ติ๊กเฉพาะงานที่เปิดเผยบนเว็บสาธารณะได้').build());
  ['detail', 'link', 'source', 'note'].forEach(function (k) { col(k).setNumberFormat('@').setWrap(true); });

  // สีในชีต: เสร็จ/ยกเลิก = เทา · เลยกำหนด = แดงอ่อน · ใกล้กำหนด = เหลืองอ่อน · เร่งด่วน = ตัวหนาสีทอง
  const all = sh.getRange(2, 1, rows, width);
  const closed = 'REGEXMATCH(' + letter('status') + ',"^(เสร็จ|ยกเลิก)")';
  const due = letter('due');
  const near = Math.max(0, Number(daysAhead) || 0);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=' + closed)
      .setFontColor('#8A8499').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER(' + due + '),' + due + '<TODAY(),NOT(' + closed + '))')
      .setBackground('#FBE7E7').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISNUMBER(' + due + '),' + due + '-TODAY()<=' + near + ',NOT(' + closed + '))')
      .setBackground('#F6EEDB').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + letter('priority') + '="' + PRIORITY_URGENT + '",NOT(' + closed + '))')
      .setFontColor('#A87A1E').setBold(true).setRanges([col('priority')]).build()
  ]);

  // เตือน (ไม่ล็อก) ถ้ามีคนแก้หัวคอลัมน์ เพราะระบบอ่านข้อมูลตามชื่อหัวคอลัมน์
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === CONFIG.HEADER_NOTE) p.remove();
  });
  sh.getRange(1, 1, 1, width).protect().setDescription(CONFIG.HEADER_NOTE).setWarningOnly(true);
  return sh;
}

function setupSettingsSheet_(ss) {
  const sh = ss.getSheetByName(CONFIG.SETTINGS_SHEET) || ss.insertSheet(CONFIG.SETTINGS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['หัวข้อ', 'ค่า', 'คำอธิบาย']])
      .setBackground('#4A2C8F').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 230);
    sh.setColumnWidth(2, 260);
    sh.setColumnWidth(3, 520);
  }
  const labels = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  SETTINGS.forEach(function (s) {
    let row = labels.indexOf(s.label) + 1;
    const isNew = row === 0;
    if (isNew) {
      labels.push(s.label);
      row = labels.length;
      sh.getRange(row, 1).setValue(s.label).setFontWeight('bold');
      sh.getRange(row, 3).setValue(s.help).setFontColor('#5E5873');
    }
    const cell = sh.getRange(row, 2);
    if (s.checkbox) cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    if (s.date) cell.setNumberFormat('d mmm yyyy');
    else if (!s.checkbox && s.key !== 'daysAhead') cell.setNumberFormat('@');
    if (isNew) {
      cell.setValue(s.key === 'email' ? Session.getEffectiveUser().getEmail() : s.def);
    }
  });
  if (labels.indexOf(HOW_TO[0]) === -1) {
    const start = Math.max(sh.getLastRow(), SETTINGS.length + 1) + 2;
    sh.getRange(start, 1, HOW_TO.length, 1).setValues(HOW_TO.map(function (t) { return [t]; }));
    sh.getRange(start, 1).setFontWeight('bold').setFontColor('#4A2C8F');
  }
}

function listRule_(items, allowOther, help) {
  return SpreadsheetApp.newDataValidation().requireValueInList(items, true)
    .setAllowInvalid(allowOther).setHelpText(help).build();
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminder')
    .timeBased().atHour(CONFIG.REMINDER_HOUR).everyDays(1).inTimezone(CONFIG.TZ)
    .create();
}


/* =============================================================================
 * หน้าเว็บ (Web app)
 * ========================================================================== */

/** ส่งข้อมูลงานที่เปิดเผยได้ให้หน้าเว็บ (อ่านอย่างเดียว ไม่รับคำสั่งแก้ไขใด ๆ) */
function doGet() {
  const cache = getCache_();
  let body = null;
  if (cache) {
    try { body = cache.get(CONFIG.CACHE_KEY); } catch (err) { body = null; }
  }
  if (!body) {
    try {
      body = JSON.stringify(publicPayload_(readTasks_(), readSettings_(), new Date().toISOString()));
      if (cache) {
        try { cache.put(CONFIG.CACHE_KEY, body, CONFIG.CACHE_SECONDS); } catch (err) { /* ข้อมูลใหญ่เกินแคชก็ยังส่งได้ */ }
      }
    } catch (err) {
      console.error('doGet: ' + (err && err.stack ? err.stack : err));
      body = JSON.stringify({ ok: false, error: 'ระบบอ่านข้อมูลจาก Google Sheet ไม่สำเร็จ' });
    }
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** คัดเฉพาะงานที่ติ๊ก "แสดงบนเว็บ" และเฉพาะช่องที่อนุญาต (whitelist) */
function publicPayload_(tasks, settings, nowIso) {
  const list = tasks
    .filter(function (t) { return t.isPublic && t.status !== STATUS.CANCELLED; })
    .sort(compareTasks_)
    .map(function (t) {
      return {
        title: clip_(t.title, 300),
        due: t.due,
        dueText: clip_(t.dueText, 60),
        time: clip_(t.time, 60),
        status: clip_(t.status, 40),
        urgent: t.urgent === true,
        category: clip_(t.category, 60),
        detail: clip_(t.detail, 1500),
        link: t.link
      };
    });
  return {
    ok: true,
    version: 1,
    updatedAt: nowIso,
    term: { name: clip_(settings.term, 40), start: settings.termStart, end: settings.termEnd },
    tasks: list
  };
}

function previewPublicData() {
  const tasks = readTasks_();
  const payload = publicPayload_(tasks, readSettings_(), new Date().toISOString());
  const hidden = tasks.length - payload.tasks.length;
  let html = '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1C1930">' +
    '<p>งานทั้งหมด <b>' + tasks.length + '</b> รายการ · แสดงบนเว็บ <b>' + payload.tasks.length +
    '</b> รายการ · ไม่แสดง <b>' + hidden + '</b> รายการ</p>' +
    '<p style="color:#5E5873">คอลัมน์ "แหล่งที่มา" และ "บันทึกส่วนตัว" ไม่ถูกส่งไปที่เว็บ งานสถานะ "ยกเลิก" ก็ไม่แสดง ' +
    'ตรวจว่าข้อความด้านล่างไม่มีชื่อหรือข้อมูลรายคนของนักเรียน</p>';
  if (payload.tasks.length) {
    html += '<table style="border-collapse:collapse;width:100%">' +
      '<tr style="background:#EDE8F8;text-align:left"><th style="padding:6px">กำหนดส่ง</th><th style="padding:6px">งาน</th>' +
      '<th style="padding:6px">สถานะ</th><th style="padding:6px">รายละเอียดและลิงก์</th></tr>';
    payload.tasks.forEach(function (t) {
      html += '<tr style="border-top:1px solid #E1DDEB;vertical-align:top">' +
        '<td style="padding:6px;white-space:nowrap">' + esc_(t.due ? thaiDate_(t.due) : (t.dueText || 'ไม่ระบุ')) +
        (t.time ? '<br>' + esc_(t.time) : '') + '</td>' +
        '<td style="padding:6px"><b>' + esc_(t.title) + '</b>' + (t.urgent ? ' <span style="color:#A87A1E">(เร่งด่วน)</span>' : '') +
        (t.category ? '<br><span style="color:#5E5873">' + esc_(t.category) + '</span>' : '') + '</td>' +
        '<td style="padding:6px">' + esc_(t.status) + '</td>' +
        '<td style="padding:6px">' + esc_(t.detail) + (t.link ? '<br>' + esc_(t.link) : '') + '</td></tr>';
    });
    html += '</table>';
  } else {
    html += '<p><b>ยังไม่มีงานที่ติ๊ก "แสดงบนเว็บ"</b></p>';
  }
  html += '<p style="margin-top:14px"><a href="' + CONFIG.WEB_PAGE_URL + '" target="_blank" rel="noopener">เปิดหน้าเว็บติดตามงาน</a> ' +
    '(ข้อมูลบนเว็บอัปเดตภายในประมาณ 1 นาที)</p></div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(760).setHeight(540), 'ข้อมูลที่จะแสดงบนเว็บ');
}


/* =============================================================================
 * แจ้งเตือนทางอีเมล
 * ========================================================================== */

/** ทำงานอัตโนมัติทุกเช้า (ตั้งโดย setup) */
function sendDailyReminder() {
  const today = todayKey_();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('lastReminderDate') === today) return; // กันส่งซ้ำในวันเดียวกัน
  let settings = null;
  try {
    settings = readSettings_();
    if (!settings.enabled) return;
    const msg = buildReminder_(readTasks_(), today, {
      daysAhead: settings.daysAhead,
      weekly: settings.weekly && dayOfWeek_(today) === 1,
      term: settings,
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
    if (msg) sendMail_(settings, msg);
    props.setProperty('lastReminderDate', today);
  } catch (err) {
    console.error('sendDailyReminder: ' + (err && err.stack ? err.stack : err));
    if (props.getProperty('lastErrorDate') !== today) {
      props.setProperty('lastErrorDate', today);
      const to = (settings && settings.email) || Session.getEffectiveUser().getEmail();
      if (to) {
        MailApp.sendEmail({
          to: to,
          name: 'ระบบติดตามงาน ครูนพพล',
          subject: 'ระบบติดตามงาน: ส่งการแจ้งเตือนวันนี้ไม่สำเร็จ',
          body: 'ระบบอ่านข้อมูลจาก Google Sheet ไม่สำเร็จ\nสาเหตุ: ' + (err && err.message ? err.message : err) +
            '\n\nวิธีแก้: เปิด Google Sheet แล้วเลือกเมนู ระบบติดตามงาน > ตั้งค่าใหม่ / ซ่อมระบบ\n' +
            'และตรวจว่าไม่ได้เปลี่ยนชื่อชีต "' + CONFIG.TASK_SHEET + '" หรือหัวคอลัมน์ในแถวที่ 1'
        });
      }
    }
  }
}

/** ส่งอีเมลสรุปทันที (ใช้ตรวจว่าระบบทำงาน) */
function sendTestEmail() {
  const settings = readSettings_();
  const msg = buildReminder_(readTasks_(), todayKey_(), {
    daysAhead: settings.daysAhead,
    weekly: true,
    test: true,
    term: settings,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  });
  const to = sendMail_(settings, msg);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'ส่งอีเมลทดสอบไปที่ ' + to + ' แล้ว ถ้าไม่พบในกล่องจดหมาย ให้ดูในจดหมายขยะ', 'ระบบติดตามงาน', 10);
}

function sendMail_(settings, msg) {
  const to = settings.email || Session.getEffectiveUser().getEmail();
  if (!to) throw new Error('ไม่พบอีเมลผู้รับ กรุณาใส่ในชีต "' + CONFIG.SETTINGS_SHEET + '"');
  MailApp.sendEmail({ to: to, subject: msg.subject, body: msg.text, htmlBody: msg.html, name: 'ระบบติดตามงาน ครูนพพล' });
  return to;
}

/**
 * สร้างเนื้อหาอีเมล คืนค่า null ถ้าไม่มีอะไรต้องแจ้ง
 * opt: { daysAhead, weekly, test, term: {term, termStart, termEnd}, sheetUrl }
 */
function buildReminder_(tasks, today, opt) {
  const horizon = opt.weekly ? Math.max(CONFIG.WEEKLY_DAYS, opt.daysAhead) : opt.daysAhead;
  const overdue = [], dueToday = [], soon = [], undated = [], badDate = [];
  tasks.filter(function (t) { return !isClosed_(t); }).forEach(function (t) {
    if (!t.due) { (t.dueText ? badDate : undated).push(t); return; }
    const d = daysBetween_(today, t.due);
    if (d < 0) overdue.push(t);
    else if (d === 0) dueToday.push(t);
    else if (d <= horizon) soon.push(t);
  });
  [overdue, dueToday, soon].forEach(function (a) { a.sort(compareTasks_); });

  const alerts = overdue.length + dueToday.length + soon.length + badDate.length;
  if (!alerts && !opt.weekly && !opt.test) return null;

  const term = opt.term || {};
  const week = weekOfTerm_(today, term.termStart, term.termEnd);
  const dateLine = thaiDate_(today, true) + (week ? ' · สัปดาห์ที่ ' + week + (term.term ? ' ภาคเรียนที่ ' + term.term : '') : '');

  const sections = [];
  if (overdue.length) sections.push({ title: 'เลยกำหนดแล้ว', tone: '#B3261E', items: overdue });
  if (dueToday.length) sections.push({ title: 'ครบกำหนดวันนี้', tone: '#A87A1E', items: dueToday });
  if (soon.length) sections.push({ title: 'ภายใน ' + horizon + ' วันข้างหน้า', tone: '#4A2C8F', items: soon });
  if (badDate.length) sections.push({ title: 'วันที่อ่านไม่ได้ (กรุณาแก้ในชีต)', tone: '#B3261E', items: badDate });
  if (opt.weekly && undated.length) sections.push({ title: 'ยังไม่กำหนดวัน', tone: '#5E5873', items: undated });

  let subject;
  if (opt.weekly) {
    subject = 'สรุปงานประจำสัปดาห์ · ' + thaiDate_(today) + (week ? ' (สัปดาห์ที่ ' + week + ')' : '');
  } else {
    const parts = [];
    if (overdue.length) parts.push('เลยกำหนด ' + overdue.length);
    if (dueToday.length) parts.push('วันนี้ ' + dueToday.length);
    if (soon.length) parts.push('ใน ' + horizon + ' วัน ' + soon.length);
    if (badDate.length) parts.push('วันที่ผิด ' + badDate.length);
    subject = 'แจ้งเตือนงาน · ' + (parts.length ? parts.join(' · ') : 'ไม่มีงานใกล้กำหนด') + ' · ' + thaiDate_(today);
  }
  if (opt.test) subject = '[ทดสอบ] ' + subject;

  const html = [];
  const text = [];
  html.push('<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1C1930;max-width:680px">');
  html.push('<div style="background:#4A2C8F;color:#FFFFFF;padding:14px 18px;border-radius:6px 6px 0 0">' +
    '<div style="font-size:12px;letter-spacing:.08em;opacity:.85">ระบบติดตามงาน ครูนพพล ภาณุสุวัฒน์</div>' +
    '<div style="font-size:18px;font-weight:bold">' + esc_(opt.weekly ? 'สรุปงานประจำสัปดาห์' : 'แจ้งเตือนงานใกล้กำหนด') + '</div>' +
    '<div style="font-size:13px">' + esc_(dateLine) + '</div></div>');
  html.push('<div style="border:1px solid #E1DDEB;border-top:0;padding:6px 18px 16px;border-radius:0 0 6px 6px">');
  text.push((opt.weekly ? 'สรุปงานประจำสัปดาห์' : 'แจ้งเตือนงานใกล้กำหนด') + '\n' + dateLine + '\n');

  if (!sections.length) {
    html.push('<p style="margin:14px 0">ไม่มีงานที่เลยกำหนดหรือครบกำหนดภายใน ' + horizon + ' วันข้างหน้า</p>');
    text.push('ไม่มีงานที่เลยกำหนดหรือครบกำหนดภายใน ' + horizon + ' วันข้างหน้า\n');
  }
  sections.forEach(function (sec) {
    html.push('<h3 style="margin:18px 0 6px;font-size:15px;color:' + sec.tone + ';border-bottom:2px solid ' + sec.tone +
      ';padding-bottom:4px">' + esc_(sec.title) + ' (' + sec.items.length + ')</h3>');
    html.push('<table style="border-collapse:collapse;width:100%">');
    text.push('\n== ' + sec.title + ' (' + sec.items.length + ') ==');
    sec.items.forEach(function (t) {
      const when = t.due ? thaiDate_(t.due, true) + ' · ' + countdown_(daysBetween_(today, t.due)) : (t.dueText || 'ยังไม่กำหนดวัน');
      const meta = [t.time, t.category, t.status, t.urgent ? PRIORITY_URGENT : '', t.isPublic ? 'แสดงบนเว็บ' : '']
        .filter(String).join(' · ');
      html.push('<tr style="border-top:1px solid #E1DDEB;vertical-align:top">' +
        '<td style="padding:8px 10px 8px 0;width:150px;color:#5E5873;font-size:13px">' + esc_(when) + '</td>' +
        '<td style="padding:8px 0"><b>' + esc_(t.title) + '</b>' +
        (meta ? '<div style="font-size:13px;color:#5E5873">' + esc_(meta) + '</div>' : '') +
        (t.detail ? '<div style="font-size:13px">' + esc_(t.detail) + '</div>' : '') +
        (t.link ? '<div style="font-size:13px"><a href="' + esc_(t.link) + '">' + esc_(t.link) + '</a></div>' : '') +
        (t.source ? '<div style="font-size:12px;color:#5E5873">ที่มา: ' + esc_(t.source) + '</div>' : '') +
        (t.note ? '<div style="font-size:12px;color:#5E5873">บันทึก: ' + esc_(t.note) + '</div>' : '') +
        '</td></tr>');
      text.push('- ' + when + ' | ' + t.title + (meta ? ' (' + meta + ')' : '') +
        (t.detail ? '\n  ' + t.detail : '') + (t.link ? '\n  ' + t.link : '') +
        (t.source ? '\n  ที่มา: ' + t.source : '') + (t.note ? '\n  บันทึก: ' + t.note : ''));
    });
    html.push('</table>');
  });
  if (!opt.weekly && undated.length) {
    html.push('<p style="margin-top:14px;color:#5E5873;font-size:13px">มีงานที่ยังไม่กำหนดวันอีก ' + undated.length + ' รายการ</p>');
    text.push('\nมีงานที่ยังไม่กำหนดวันอีก ' + undated.length + ' รายการ');
  }
  html.push('<p style="margin-top:18px;font-size:13px">' +
    (opt.sheetUrl ? '<a href="' + esc_(opt.sheetUrl) + '" style="color:#4A2C8F">เปิด Google Sheet</a> · ' : '') +
    '<a href="' + CONFIG.WEB_PAGE_URL + '" style="color:#4A2C8F">เปิดหน้าเว็บติดตามงาน</a></p>');
  html.push('<p style="font-size:12px;color:#8A8499">อีเมลนี้ส่งอัตโนมัติจาก Google Sheet ของครู ' +
    'ปิดหรือปรับจำนวนวันแจ้งเตือนได้ที่ชีต "' + CONFIG.SETTINGS_SHEET + '"</p></div></div>');
  text.push('\n' + (opt.sheetUrl ? 'Google Sheet: ' + opt.sheetUrl + '\n' : '') + 'หน้าเว็บ: ' + CONFIG.WEB_PAGE_URL);

  return { subject: subject, html: html.join(''), text: text.join('\n') };
}


/* =============================================================================
 * แก้ไขในชีต
 * ========================================================================== */

/**
 * ทำงานทุกครั้งที่ครูแก้ชีต: ล้างแคชให้เว็บเห็นข้อมูลใหม่ทันที
 * และแปลงปี พ.ศ. ในคอลัมน์ "กำหนดส่ง" เป็น ค.ศ. (เช่น 30/10/2569 หรือ 30/10/69 → 30 ต.ค. 2026)
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const name = sh.getName();
  if (name !== CONFIG.TASK_SHEET && name !== CONFIG.SETTINGS_SHEET) return;
  clearCache_();
  try {
    const r = e.range;
    const tz = e.source.getSpreadsheetTimeZone() || CONFIG.TZ;
    let target = null;
    if (name === CONFIG.TASK_SHEET) {
      const idx = headerIndex_(sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]);
      if (idx.due === undefined) return;
      const c = idx.due + 1;
      const top = Math.max(r.getRow(), 2);
      if (c < r.getColumn() || c > r.getLastColumn() || r.getLastRow() < top) return;
      target = sh.getRange(top, c, r.getLastRow() - top + 1, 1);
    } else {
      if (r.getColumn() > 2 || r.getLastColumn() < 2) return;
      const labels = sh.getRange(r.getRow(), 1, r.getNumRows(), 1).getValues();
      const dateLabels = SETTINGS.filter(function (s) { return s.date; }).map(function (s) { return s.label; });
      if (!labels.some(function (l) { return dateLabels.indexOf(String(l[0]).trim()) !== -1; })) return;
      target = sh.getRange(r.getRow(), 2, r.getNumRows(), 1);
      const fixed = target.getValues().map(function (v, i) {
        return dateLabels.indexOf(String(labels[i][0]).trim()) === -1 ? null : v[0];
      });
      fixDateCells_(target, fixed, tz);
      return;
    }
    fixDateCells_(target, target.getValues().map(function (v) { return v[0]; }), tz);
  } catch (err) {
    console.warn('onEdit: ' + err);
  }
}

/** values: ค่าเดิมของแต่ละเซลล์ (null = ข้าม) เขียนกลับเฉพาะเมื่อมีเซลล์ที่ต้องแก้ */
function fixDateCells_(range, values, tz) {
  const out = normalizeDateCells_(values, tz);
  if (!out) return;
  const cells = range.getValues();
  out.forEach(function (v, i) { if (v !== null) cells[i][0] = v; });
  range.setValues(cells);
}

/** คืนค่า array ของค่าที่ต้องเขียนแทน (null = ไม่ต้องแก้) หรือ null ถ้าไม่มีอะไรต้องแก้ */
function normalizeDateCells_(values, tz) {
  let changed = false;
  const out = values.map(function (v) {
    if (v === null || v === '' || v === undefined) return null;
    const key = toDateKey_(v, tz);
    if (!key) return null;
    if (isDate_(v) && Utilities.formatDate(v, tz, 'yyyy-MM-dd') === key) return null;
    changed = true;
    return key; // ข้อความ yyyy-MM-dd Google Sheets แปลงเป็นวันที่ให้เองทุกภาษา
  });
  return changed ? out : null;
}


/* =============================================================================
 * อ่านข้อมูล
 * ========================================================================== */

function readTasks_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.TASK_SHEET);
  if (!sh) throw new Error('ไม่พบชีต "' + CONFIG.TASK_SHEET + '"');
  return rowsToTasks_(sh.getDataRange().getValues(), ss.getSpreadsheetTimeZone() || CONFIG.TZ);
}

function rowsToTasks_(values, tz) {
  if (!values.length) return [];
  const idx = headerIndex_(values[0]);
  if (idx.title === undefined) throw new Error('ไม่พบหัวคอลัมน์ "งาน" ในแถวที่ 1');
  const tasks = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const cell = function (key) { return idx[key] === undefined ? '' : row[idx[key]]; };
    const title = cellText_(cell('title'), tz);
    if (!title) continue;
    const due = toDateKey_(cell('due'), tz);
    tasks.push({
      row: r + 1,
      title: title,
      due: due,
      dueText: due ? '' : cellText_(cell('due'), tz),
      time: cellText_(cell('time'), tz),
      status: normStatus_(cellText_(cell('status'), tz)),
      urgent: cellText_(cell('priority'), tz) === PRIORITY_URGENT,
      category: cellText_(cell('category'), tz),
      isPublic: isTrue_(cell('public')),
      detail: cellText_(cell('detail'), tz),
      link: safeLink_(cellText_(cell('link'), tz)),
      source: cellText_(cell('source'), tz),
      note: cellText_(cell('note'), tz)
    });
  }
  return tasks;
}

function readSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SETTINGS_SHEET);
  const raw = {};
  if (sh && sh.getLastRow() > 0) {
    sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) {
      const label = String(r[0]).trim();
      if (label && !(label in raw)) raw[label] = r[1];
    });
  }
  return parseSettings_(raw, ss.getSpreadsheetTimeZone() || CONFIG.TZ);
}

/** raw: { ป้ายหัวข้อ: ค่าในเซลล์ } หัวข้อที่หายไปใช้ค่าเริ่มต้น */
function parseSettings_(raw, tz) {
  const get = function (key) {
    const s = SETTINGS.filter(function (x) { return x.key === key; })[0];
    return Object.prototype.hasOwnProperty.call(raw, s.label) ? raw[s.label] : s.def;
  };
  const days = parseInt(get('daysAhead'), 10);
  const emails = String(get('email') || '').split(/[\s,;]+/).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  return {
    email: emails.join(','),
    enabled: isTrue_(get('enabled')),
    daysAhead: isNaN(days) ? 3 : Math.min(30, Math.max(0, days)),
    weekly: isTrue_(get('weekly')),
    term: cellText_(get('term'), tz),
    termStart: toDateKey_(get('termStart'), tz),
    termEnd: toDateKey_(get('termEnd'), tz)
  };
}

/** ชื่อหัวคอลัมน์ → ตำแหน่ง (ไม่สนช่องว่างและข้อความในวงเล็บ) */
function headerIndex_(headers) {
  const want = {};
  COLUMNS.forEach(function (c) { want[normHeader_(c.header)] = c.key; });
  const idx = {};
  headers.forEach(function (h, i) {
    const key = want[normHeader_(h)];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  return idx;
}

function normHeader_(h) {
  return String(h === null || h === undefined ? '' : h).replace(/\(.*?\)/g, '').replace(/\s+/g, '');
}


/* =============================================================================
 * ตัวช่วย
 * ========================================================================== */

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function isTrue_(v) {
  return v === true || /^(true|ใช่)$/i.test(String(v).trim());
}

function normStatus_(s) {
  if (!s) return STATUS.TODO;
  if (/^เสร็จ/.test(s)) return STATUS.DONE;
  if (/^ยกเลิก/.test(s)) return STATUS.CANCELLED;
  return s;
}

function isClosed_(t) {
  return t.status === STATUS.DONE || t.status === STATUS.CANCELLED;
}

function safeLink_(s) {
  return /^https?:\/\/[^\s<>"']+$/i.test(s) && s.length <= 500 ? s : '';
}

function clip_(s, n) {
  s = String(s === null || s === undefined ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cellText_(v, tz) {
  if (v === null || v === undefined) return '';
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return '';
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH.mm') + ' น.'; // ช่องที่เป็นเวลาอย่างเดียว
    const key = toDateKey_(v, tz);
    return key ? thaiDate_(key) : '';
  }
  return String(v).trim();
}

/** ค่าในเซลล์ → 'yyyy-MM-dd' (ค.ศ.) หรือ '' ถ้าไม่ใช่วันที่ */
function toDateKey_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return '';
    const p = Utilities.formatDate(v, tz, 'yyyy-M-d').split('-').map(Number);
    let y = p[0];
    // Google Sheets อ่านปี 2 หลักอย่าง 30/10/69 เป็น 1969 ซึ่งครูหมายถึง พ.ศ. 2569
    if (y >= 1960 && y < 2000) y += 57;
    return makeKey_(y, p[1], p[2]);
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 100000) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); // เลขวันที่แบบสเปรดชีต
    return makeKey_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return parseDateText_(String(v));
}

/** รองรับ 30/10/2569 · 30-10-69 · 2026-10-30 · 30 ต.ค. 2569 · 30 ตุลาคม พ.ศ. 2569 · เลขไทย */
function parseDateText_(s) {
  s = String(s)
    .replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); })
    .replace(/(พ\.\s?ศ\.|ค\.\s?ศ\.)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return makeKey_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4}|\d{2})$/);
  if (m) return makeKey_(expandYear_(m[3]), +m[2], +m[1]);
  m = s.match(/(\d{1,2})\s?([฀-๿.]+)\s?(\d{4}|\d{2})$/);
  if (m) {
    const month = thaiMonthNumber_(m[2]);
    if (month) return makeKey_(expandYear_(m[3]), month, +m[1]);
  }
  return '';
}

function thaiMonthNumber_(word) {
  const w = word.replace(/[.\s]/g, '');
  for (let i = 0; i < 12; i++) {
    if (w === TH_MONTHS[i] || w === TH_MONTHS_ABBR[i].replace(/\./g, '')) return i + 1;
  }
  return 0;
}

/** ปี 2 หลัก: 60–99 ถือเป็น พ.ศ. 25xx, 00–59 ถือเป็น ค.ศ. 20xx */
function expandYear_(str) {
  const y = parseInt(str, 10);
  if (str.length > 2) return y;
  return y >= 60 ? 2500 + y : 2000 + y;
}

/** ปีที่มากกว่า 2400 ถือเป็น พ.ศ. แล้วแปลงเป็น ค.ศ. · ตรวจว่าวันมีอยู่จริง */
function makeKey_(y, m, d) {
  if (y > 2400) y -= 543;
  if (!(y >= 1900 && y <= 2400) || !(m >= 1 && m <= 12) || !(d >= 1)) return '';
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return '';
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function keyToUtc_(key) {
  const p = key.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function daysBetween_(fromKey, toKey) {
  return Math.round((keyToUtc_(toKey) - keyToUtc_(fromKey)) / 86400000);
}

function dayOfWeek_(key) {
  return new Date(keyToUtc_(key)).getUTCDay();
}

function todayKey_() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' → '30 ต.ค. 2569' หรือ 'ศุกร์ 30 ต.ค. 2569' */
function thaiDate_(key, withDay) {
  const p = key.split('-').map(Number);
  return (withDay ? TH_DAYS[dayOfWeek_(key)] + ' ' : '') + p[2] + ' ' + TH_MONTHS_ABBR[p[1] - 1] + ' ' + (p[0] + 543);
}

function countdown_(d) {
  if (d < 0) return 'เลยมา ' + (-d) + ' วัน';
  if (d === 0) return 'วันนี้';
  if (d === 1) return 'พรุ่งนี้';
  return 'อีก ' + d + ' วัน';
}

/** สัปดาห์ที่เท่าไรของภาคเรียน (0 = อยู่นอกภาคเรียน) */
function weekOfTerm_(key, start, end) {
  if (!start) return 0;
  const d = daysBetween_(start, key);
  if (d < 0 || (end && daysBetween_(end, key) > 0)) return 0;
  return Math.floor(d / 7) + 1;
}

/** เรียงตามกำหนดส่ง (ไม่มีวันอยู่ท้าย) แล้วงานเร่งด่วนก่อน แล้วตามลำดับแถว */
function compareTasks_(a, b) {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  return (a.row || 0) - (b.row || 0);
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getCache_() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}

function clearCache_() {
  const cache = getCache_();
  if (!cache) return;
  try { cache.remove(CONFIG.CACHE_KEY); } catch (err) { /* แคชหมดอายุเองภายใน 1 นาที */ }
}
