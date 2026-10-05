const DEFAULT_CONFIG = {
  targetCodeColumn: "รหัสสินค้า",
  vrichMatchColumn: "รหัสขาย",
  jstMatchColumn: "รหัสรูปแบบ",
  vrichQtyColumn: "จำนวน",
  jstPhysicalQtyColumn: "จำนวน",
  jstAvailableQtyColumn: "จํานวนที่ใช้ได้",
  comboCodeColumn: "รหัสรูปแบบคอมโบเซ็ต",
  comboComponentColumn: "รหัสสินค้า",
  comboRequiredQtyColumn: "จำนวน",
};

const STATUS_LABELS = {
  IDLE: "รอประมวลผล",
  PASS: "PASS: พร้อมตรวจขั้นสุดท้ายก่อนนำเข้า",
  PASS_WITH_EXCLUSION: "PASS_WITH_EXCLUSION: ผ่านแบบมีรหัสที่ผู้ใช้ยืนยันให้ข้าม",
  FAIL: "FAIL: ยังไม่ควรนำเข้า",
  FAIL_DUPLICATE: "FAIL_DUPLICATE: พบข้อมูลซ้ำที่กระทบรายการอัปเดต",
  BLOCKED: "BLOCKED: มีรายการที่ระบบไม่ยอมเดา ต้องตรวจหรือยืนยันให้ข้ามก่อน",
};

const FILE_SIZE_WARNING_MB = 30;
const FILE_SIZE_BLOCK_MB = 80;
const LARGE_FILE_ERROR_MESSAGE =
  "ไฟล์ Excel ใหญ่เกินกว่าที่ browser จะอ่านได้ในรอบเดียว กรุณาใช้ไฟล์ export แบบไม่มีรูปภาพ/ลดขนาดไฟล์ หรือใช้เวอร์ชัน Python สำหรับไฟล์ขนาดใหญ่";

const state = {
  files: { vrich: null, jst: null, combo: null, target: null },
  tables: null,
  result: null,
  excludedCodes: new Set(),
  downloads: [],
  isBusy: false,
};

const els = {
  vrichFile: document.getElementById("vrichFile"),
  jstFile: document.getElementById("jstFile"),
  comboFile: document.getElementById("comboFile"),
  targetFile: document.getElementById("targetFile"),
  vrichFileName: document.getElementById("vrichFileName"),
  jstFileName: document.getElementById("jstFileName"),
  comboFileName: document.getElementById("comboFileName"),
  targetFileName: document.getElementById("targetFileName"),
  targetCodeColumn: document.getElementById("targetCodeColumn"),
  vrichMatchColumn: document.getElementById("vrichMatchColumn"),
  jstMatchColumn: document.getElementById("jstMatchColumn"),
  vrichQtyColumn: document.getElementById("vrichQtyColumn"),
  jstPhysicalQtyColumn: document.getElementById("jstPhysicalQtyColumn"),
  jstAvailableQtyColumn: document.getElementById("jstAvailableQtyColumn"),
  familyExpansionEnabled: document.getElementById("familyExpansionEnabled"),
  sharedComboPolicy: document.getElementById("sharedComboPolicy"),
  inspectButton: document.getElementById("inspectButton"),
  processButton: document.getElementById("processButton"),
  clearButton: document.getElementById("clearButton"),
  applyExclusionsButton: document.getElementById("applyExclusionsButton"),
  statusPanel: document.getElementById("statusPanel"),
  preflightGrid: document.getElementById("preflightGrid"),
  summaryGrid: document.getElementById("summaryGrid"),
  issuePanel: document.getElementById("issuePanel"),
  issueTableWrap: document.getElementById("issueTableWrap"),
  expansionPanel: document.getElementById("expansionPanel"),
  expansionTableWrap: document.getElementById("expansionTableWrap"),
  downloadPanel: document.getElementById("downloadPanel"),
  downloadList: document.getElementById("downloadList"),
  runStatus: document.getElementById("runStatus"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingMessage: document.getElementById("loadingMessage"),
};

const busyButtons = [els.inspectButton, els.processButton, els.clearButton, els.applyExclusionsButton].filter(Boolean);
busyButtons.forEach((button) => {
  button.dataset.defaultText = button.textContent;
});

function getConfig() {
  return {
    ...DEFAULT_CONFIG,
    targetCodeColumn: els.targetCodeColumn.value.trim() || DEFAULT_CONFIG.targetCodeColumn,
    vrichMatchColumn: els.vrichMatchColumn.value.trim() || DEFAULT_CONFIG.vrichMatchColumn,
    jstMatchColumn: els.jstMatchColumn.value.trim() || DEFAULT_CONFIG.jstMatchColumn,
    vrichQtyColumn: els.vrichQtyColumn.value.trim() || DEFAULT_CONFIG.vrichQtyColumn,
    jstPhysicalQtyColumn: els.jstPhysicalQtyColumn.value.trim() || DEFAULT_CONFIG.jstPhysicalQtyColumn,
    jstAvailableQtyColumn: els.jstAvailableQtyColumn.value.trim() || DEFAULT_CONFIG.jstAvailableQtyColumn,
    familyExpansionEnabled: els.familyExpansionEnabled.checked,
    sharedComboPolicy: els.sharedComboPolicy.value || "block",
  };
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/\ufeff/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setStatus(message, kind = "ok") {
  els.statusPanel.textContent = message;
  els.statusPanel.className = `status-panel visible ${kind}`;
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function updateLoading(message, title = "กำลังทำงาน...") {
  els.loadingTitle.textContent = title;
  els.loadingMessage.textContent = message;
}

function setBusy(isBusy, options = {}) {
  state.isBusy = isBusy;
  els.loadingOverlay.classList.toggle("hidden", !isBusy);
  document.body.classList.toggle("is-loading", isBusy);
  if (isBusy) updateLoading(options.message || "กรุณารอสักครู่", options.title || "กำลังทำงาน...");
  for (const button of busyButtons) {
    button.disabled = isBusy || (button === els.processButton && !state.tables);
    button.textContent = button.dataset.defaultText;
  }
  if (isBusy && options.button) options.button.textContent = options.busyText || options.button.dataset.defaultText;
}

async function runLoadingTask(options, task) {
  setBusy(true, options);
  try {
    await waitForPaint();
    await task();
  } catch (error) {
    console.error(error);
    setStatus(normalizeWorkbookError(error).message, "danger");
  } finally {
    setBusy(false);
  }
}

function setRunStatus(status) {
  els.runStatus.textContent = STATUS_LABELS[status] || status;
  els.runStatus.className = "status-pill";
  if (status === "PASS" || status === "PASS_WITH_EXCLUSION") els.runStatus.classList.add("pass");
  else if (status === "IDLE") els.runStatus.classList.add("idle");
  else if (status === "BLOCKED" || status === "FAIL" || status === "FAIL_DUPLICATE") els.runStatus.classList.add("fail");
  else els.runStatus.classList.add("warn");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateFileLabel(kind, file) {
  const label = {
    vrich: els.vrichFileName,
    jst: els.jstFileName,
    combo: els.comboFileName,
    target: els.targetFileName,
  }[kind];
  label.textContent = file ? `${file.name} (${formatFileSize(file.size)})` : "ยังไม่ได้เลือกไฟล์";
}

function fileSizeMb(file) {
  return file.size / (1024 * 1024);
}

function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function selectedFiles() {
  return [
    { label: "ไฟล์ vRich", file: state.files.vrich },
    { label: "ไฟล์ JST Item", file: state.files.jst },
    { label: "ไฟล์ JST Combo", file: state.files.combo },
    { label: "ไฟล์รหัสที่ต้องการปรับ", file: state.files.target },
  ].filter((item) => item.file);
}

function validateFileSizes() {
  const files = selectedFiles();
  const blocked = files.filter((item) => fileSizeMb(item.file) > FILE_SIZE_BLOCK_MB);
  const warnings = files.filter(
    (item) => fileSizeMb(item.file) > FILE_SIZE_WARNING_MB && fileSizeMb(item.file) <= FILE_SIZE_BLOCK_MB
  );
  if (blocked.length) {
    const names = blocked.map((item) => `${item.label}: ${item.file.name} (${formatFileSize(item.file.size)})`).join(", ");
    throw new Error(`${LARGE_FILE_ERROR_MESSAGE}\nไฟล์ที่ใหญ่เกิน 80 MB: ${names}`);
  }
  return warnings;
}

function isAllocationError(error) {
  const message = String(error && (error.message || error));
  return /array buffer allocation failed|out of memory|cannot allocate|allocation failed|invalid array length/i.test(message);
}

function normalizeWorkbookError(error) {
  if (isAllocationError(error)) return new Error(LARGE_FILE_ERROR_MESSAGE);
  return error instanceof Error ? error : new Error(String(error));
}

async function readWorkbook(file, label) {
  try {
    updateLoading(`กำลังอ่านไฟล์ ${label}...`, "กำลังตรวจสอบไฟล์");
    await waitForPaint();
    const buffer = await file.arrayBuffer();
    updateLoading(`กำลังแปลงข้อมูล Excel จากไฟล์ ${label}...`, "กำลังตรวจสอบไฟล์");
    await waitForPaint();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    const headerRow = matrix.find((row) => row.some((cell) => normalizeHeader(cell)));
    if (!headerRow) throw new Error(`ไม่พบแถวหัวคอลัมน์ในไฟล์ ${file.name}`);
    const headers = headerRow.map(normalizeHeader);
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    const headerIndex = matrix.indexOf(headerRow);
    const rows = matrix
      .slice(headerIndex + 1)
      .map((row) => {
        const item = {};
        headers.forEach((header, index) => {
          item[header] = row[index] ?? "";
        });
        return item;
      })
      .filter((row) => headers.some((header) => String(row[header] ?? "").trim() !== ""));
    return { file, workbook, sheetName, headers, rows };
  } catch (error) {
    throw normalizeWorkbookError(error);
  }
}

function requireColumns(table, columns, label) {
  const missing = columns.filter((column) => !table.headers.includes(column));
  if (missing.length) throw new Error(`${label} ไม่มีคอลัมน์: ${missing.join(", ")}`);
}

async function inspectFiles() {
  const config = getConfig();
  if (!state.files.vrich || !state.files.jst || !state.files.combo || !state.files.target) {
    throw new Error("กรุณาเลือกไฟล์ให้ครบ 4 ไฟล์: vRich, JST Item, JST Combo และไฟล์รหัสที่ต้องการปรับ");
  }
  updateLoading("กำลังตรวจสอบขนาดไฟล์และเตรียมอ่านข้อมูล...", "กำลังตรวจสอบไฟล์");
  await waitForPaint();
  const sizeWarnings = validateFileSizes();

  const vrich = await readWorkbook(state.files.vrich, "vRich");
  const jst = await readWorkbook(state.files.jst, "JST Item");
  const combo = await readWorkbook(state.files.combo, "JST Combo/Set");
  const target = await readWorkbook(state.files.target, "รหัสที่ต้องการปรับ");

  updateLoading("กำลังตรวจคอลัมน์ที่จำเป็น...", "กำลังตรวจสอบไฟล์");
  await waitForPaint();
  requireColumns(vrich, [config.vrichMatchColumn, config.vrichQtyColumn], "vRich");
  requireColumns(jst, [config.jstMatchColumn, config.jstAvailableQtyColumn], "JST Item");
  if (config.jstPhysicalQtyColumn) requireColumns(jst, [config.jstPhysicalQtyColumn], "JST Item");
  requireColumns(combo, [config.comboCodeColumn, config.comboComponentColumn, config.comboRequiredQtyColumn], "JST Combo");
  requireColumns(target, [config.targetCodeColumn], "ไฟล์รหัสที่ต้องการปรับ");

  state.tables = { vrich, jst, combo, target };
  renderPreflight();
  els.processButton.disabled = false;
  if (sizeWarnings.length) {
    const names = sizeWarnings.map((item) => `${item.label}: ${item.file.name} (${formatFileSize(item.file.size)})`).join(", ");
    setStatus(`ตรวจสอบไฟล์ผ่าน แต่มีไฟล์ใหญ่กว่า ${FILE_SIZE_WARNING_MB} MB: ${names}`, "warn");
  } else {
    setStatus("ตรวจสอบไฟล์ผ่าน: ระบบจะใช้ JST 'จํานวนที่ใช้ได้' เป็นสต๊อกพร้อมขาย", "ok");
  }
}

function renderPreflight() {
  if (!state.tables) {
    els.preflightGrid.innerHTML = "";
    return;
  }
  const tableEntries = [
    ["ไฟล์ vRich master", state.tables.vrich],
    ["ไฟล์ JST Item", state.tables.jst],
    ["ไฟล์ JST Combo/Set", state.tables.combo],
    ["ไฟล์รหัสที่ต้องการปรับ (Scope)", state.tables.target],
  ];
  els.preflightGrid.innerHTML = tableEntries
    .map(([label, table]) => `
      <article class="file-card">
        <h3>${escapeHtml(label)}</h3>
        <dl>
          <dt>ไฟล์</dt><dd>${escapeHtml(table.file.name)}</dd>
          <dt>ขนาด</dt><dd>${formatFileSize(table.file.size)}</dd>
          <dt>ชื่อชีต</dt><dd>${escapeHtml(table.sheetName)}</dd>
          <dt>แถว</dt><dd>${table.rows.length.toLocaleString()}</dd>
          <dt>คอลัมน์</dt><dd>${table.headers.length.toLocaleString()}</dd>
        </dl>
        <div class="columns">${escapeHtml(table.headers.join(", "))}</div>
      </article>
    `)
    .join("");
}

function duplicateCodes(index, outputScope) {
  const scope = new Set(outputScope.map((item) => item.code));
  return [...index.entries()]
    .filter(([code, rows]) => scope.has(code) && rows.length > 1)
    .map(([code, rows]) => ({ code, count: rows.length }));
}

function currentVrichQty(row, column) {
  const value = StockEngine.toFiniteNumber(row?.[column]);
  return value === null ? "" : value;
}


/* =========================================================
   vRich Stock Update Note
   ตัวอย่างผลลัพธ์:

   จำนวน 4 | 05/10/69 |
   1 ร้านพี่เพชร (จ่ายโชว์ JST-6672)
   23/4/69 จูนตามระบบ JST

   - เพิ่มหมายเหตุใหม่ไว้ด้านบน
   - ไม่ลบหมายเหตุเก่า
   - ใช้จำนวนใหม่ที่กำลังอัปเข้า vRich
   - วันที่เป็น พ.ศ. DD/MM/YY
   - ใช้เวลา Asia/Bangkok
   - ป้องกันการเพิ่มบรรทัดเดียวกันซ้ำ
   ========================================================= */

function formatThaiShortDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const day =
    parts.find((part) => part.type === "day")?.value || "";

  const month =
    parts.find((part) => part.type === "month")?.value || "";

  const yearAD = Number(
    parts.find((part) => part.type === "year")?.value || 0
  );

  const yearBE = yearAD + 543;
  const yearBE2 = String(yearBE).slice(-2);

  return `${day}/${month}/${yearBE2}`;
}


function normalizeNoteLine(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function prependStockUpdateNote(oldNote, newQty, dateText) {
  const newLine = `จำนวน ${newQty} | ${dateText} |`;

  const oldText =
    oldNote == null
      ? ""
      : String(oldNote)
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");

  const oldTrimmed = oldText.trim();

  // ไม่มีหมายเหตุเก่า
  if (!oldTrimmed) {
    return newLine;
  }

  // ตรวจบรรทัดแรก ป้องกันการกดประมวลผลซ้ำ
  // แล้วเพิ่ม "จำนวน X | วันที่ |" ซ้ำอีกครั้ง
  const firstOldLine = oldTrimmed.split("\n")[0];

  if (
    normalizeNoteLine(firstOldLine) ===
    normalizeNoteLine(newLine)
  ) {
    return oldText;
  }

  // หมายเหตุใหม่อยู่ด้านบน
  // หมายเหตุเดิมทั้งหมดอยู่ด้านล่าง
  return `${newLine}\n${oldText}`;
}


function processData() {
  if (!state.tables) {
    throw new Error("กรุณาตรวจสอบไฟล์ก่อนประมวลผล");
  }

  const config = getConfig();
  const { vrich, jst, combo, target } = state.tables;

  requireColumns(
    vrich,
    [config.vrichMatchColumn, config.vrichQtyColumn],
    "vRich"
  );

  requireColumns(
    jst,
    [config.jstMatchColumn, config.jstAvailableQtyColumn],
    "JST Item"
  );

  requireColumns(
    combo,
    [
      config.comboCodeColumn,
      config.comboComponentColumn,
      config.comboRequiredQtyColumn,
    ],
    "JST Combo"
  );

  requireColumns(
    target,
    [config.targetCodeColumn],
    "ไฟล์รหัสที่ต้องการปรับ"
  );


  /* ---------------------------------------------------------
     หมายเหตุ vRich
     --------------------------------------------------------- */

  const vrichNoteColumn = "หมายเหตุ";

  // วันที่เดียวกันทั้งรอบการประมวลผล
  const runDateText = formatThaiShortDate();


  /* ---------------------------------------------------------
     สร้าง Index
     --------------------------------------------------------- */

  const vrichIndex = StockEngine.buildIndex(
    vrich.rows,
    config.vrichMatchColumn
  );

  const jstIndex = StockEngine.buildIndex(
    jst.rows,
    config.jstMatchColumn
  );

  const comboMap = StockEngine.buildComboMap(
    combo.rows,
    config
  );

  const comboCodeSet = new Set(comboMap.keys());
  const jstCodeSet = new Set(jstIndex.keys());


  /* ---------------------------------------------------------
     Scope / Family Expansion
     --------------------------------------------------------- */

  const scope = StockEngine.expandTargets(
    target.rows,
    config.targetCodeColumn,
    vrichIndex,
    [jstCodeSet, comboCodeSet],
    config.familyExpansionEnabled
  );

  const outputScope = scope.outputs;

  const outputScopeSet = new Set(
    outputScope.map((item) => item.code)
  );


  /* ---------------------------------------------------------
     Duplicate Check
     --------------------------------------------------------- */

  const duplicateVrich = duplicateCodes(
    vrichIndex,
    outputScope
  );

  const duplicateVrichSet = new Set(
    duplicateVrich.map((item) => item.code)
  );


  /* ---------------------------------------------------------
     Combo Component Usage
     --------------------------------------------------------- */

  const componentUsage =
    StockEngine.buildActiveComponentUsage(
      comboMap,
      vrichIndex,
      config.vrichQtyColumn,
      outputScopeSet
    );


  /* ---------------------------------------------------------
     Result Containers
     --------------------------------------------------------- */

  const updateRows = [];
  const auditRows = [];
  const issues = [];
  const negativeAvailable = [];
  const directUpdated = [];
  const comboUpdated = [];


  /* ---------------------------------------------------------
     Process แต่ละ SKU ใน Output Scope
     --------------------------------------------------------- */

  for (const targetItem of outputScope) {
    const code = targetItem.code;

    const vrichRows =
      vrichIndex.get(code) || [];

    const excludedAtScopeCheck =
      state.excludedCodes.has(code);


    /* -------------------------------------------------------
       ไม่พบใน vRich
       ------------------------------------------------------- */

    if (!vrichRows.length) {
      if (!excludedAtScopeCheck) {
        issues.push({
          code,
          type: "MISSING_VRICH",
          message: "อยู่ใน Scope แต่ไม่พบใน vRich",
          source: "SCOPE",
          inputCodes: targetItem.inputCodes,
        });
      }

      auditRows.push(
        makeAuditRow({
          code,
          targetItem,
          status: excludedAtScopeCheck
            ? "EXCLUDED_MISSING_VRICH"
            : "MISSING_VRICH",
          source: "-",
          message: "ไม่พบใน vRich",
        })
      );

      continue;
    }


    /* -------------------------------------------------------
       Duplicate vRich
       ------------------------------------------------------- */

    if (
      vrichRows.length !== 1 ||
      duplicateVrichSet.has(code)
    ) {
      if (!excludedAtScopeCheck) {
        issues.push({
          code,
          type: "DUPLICATE_VRICH",
          message: `พบรหัสซ้ำใน vRich ${vrichRows.length} แถว`,
          source: "vRich",
          inputCodes: targetItem.inputCodes,
        });
      }

      auditRows.push(
        makeAuditRow({
          code,
          targetItem,
          status: excludedAtScopeCheck
            ? "EXCLUDED_DUPLICATE_VRICH"
            : "DUPLICATE_VRICH",
          source: "vRich",
          message: `ซ้ำ ${vrichRows.length} แถว`,
        })
      );

      continue;
    }


    /* -------------------------------------------------------
       Resolve Stock
       ------------------------------------------------------- */

    const stock =
      StockEngine.resolveStockForCode({
        code,
        jstIndex,
        comboMap,
        componentUsage,
        jstAvailableColumn:
          config.jstAvailableQtyColumn,
        jstPhysicalColumn:
          config.jstPhysicalQtyColumn,
        sharedPolicy:
          config.sharedComboPolicy,
      });


    const vrichRow = vrichRows[0];

    const excluded =
      state.excludedCodes.has(code);


    const commonAudit = {
      code,
      targetItem,
      source: stock.source,

      oldQty: currentVrichQty(
        vrichRow,
        config.vrichQtyColumn
      ),

      newQty:
        stock.quantity ?? "",

      physicalRaw:
        stock.physicalRaw ?? "",

      availableRaw:
        stock.availableRaw ?? "",

      dependencies:
        stock.dependencies || [],

      warnings:
        stock.warnings || [],

      message:
        stock.message || "",
    };


    /* -------------------------------------------------------
       Stock Engine แจ้งปัญหา
       ------------------------------------------------------- */

    if (stock.status !== "OK") {
      if (!excluded) {
        issues.push({
          code,
          type: stock.status,
          message:
            stock.message || stock.status,
          source: stock.source,
          inputCodes:
            targetItem.inputCodes,
        });
      }

      auditRows.push(
        makeAuditRow({
          ...commonAudit,
          status: excluded
            ? `EXCLUDED_${stock.status}`
            : stock.status,
        })
      );

      continue;
    }


    /* -------------------------------------------------------
       User Exclusion
       ------------------------------------------------------- */

    if (excluded) {
      auditRows.push(
        makeAuditRow({
          ...commonAudit,
          status: "EXCLUDED_BY_USER",
        })
      );

      continue;
    }


    /* =======================================================
       สร้างแถวใหม่สำหรับ vRich
       ======================================================= */

    const outputRow = {};

    // Copy ข้อมูลเดิมทั้งหมดก่อน
    for (const header of vrich.headers) {
      outputRow[header] =
        vrichRow[header];
    }


    /* -------------------------------------------------------
       Update จำนวน
       ------------------------------------------------------- */

    outputRow[
      config.vrichQtyColumn
    ] = stock.quantity;


    /* -------------------------------------------------------
       Update หมายเหตุ

       ตัวอย่าง:
       จำนวน 4 | 05/10/69 |
       <หมายเหตุเดิม>
       ------------------------------------------------------- */

    if (vrich.headers.includes(vrichNoteColumn)) {
      outputRow[vrichNoteColumn] =
        prependStockUpdateNote(
          vrichRow[vrichNoteColumn],
          stock.quantity,
          runDateText
        );
    }


    /* -------------------------------------------------------
       เพิ่มเข้า Import
       ------------------------------------------------------- */

    updateRows.push(outputRow);


    /* -------------------------------------------------------
       Count Direct / Combo
       ------------------------------------------------------- */

    if (stock.source === "COMBO") {
      comboUpdated.push(code);
    } else {
      directUpdated.push(code);
    }


    /* -------------------------------------------------------
       Negative Available Warning
       ------------------------------------------------------- */

    if (
      (stock.warnings || []).some(
        (item) => /ติดลบ/.test(item)
      )
    ) {
      negativeAvailable.push({
        code,
        warnings: stock.warnings,
      });
    }


    /* -------------------------------------------------------
       Audit
       ------------------------------------------------------- */

    auditRows.push(
      makeAuditRow({
        ...commonAudit,
        status: "OK",
      })
    );
  }


  /* ---------------------------------------------------------
     Active Issues
     --------------------------------------------------------- */

  const activeIssues =
    issues.filter(
      (item) =>
        !state.excludedCodes.has(item.code)
    );


  const excluded =
    [...state.excludedCodes].filter(
      (code) =>
        outputScopeSet.has(code)
    );


  /* ---------------------------------------------------------
     Final Status
     --------------------------------------------------------- */

  let status = "PASS";

  if (
    activeIssues.some(
      (item) =>
        item.type.includes("DUPLICATE")
    )
  ) {
    status = "FAIL_DUPLICATE";
  } else if (
    activeIssues.some(
      (item) =>
        item.type === "MISSING_VRICH" ||
        item.type === "MISSING_JST" ||
        item.type === "MISSING_COMPONENT"
    )
  ) {
    status = "FAIL";
  } else if (activeIssues.length) {
    status = "BLOCKED";
  } else if (excluded.length) {
    status = "PASS_WITH_EXCLUSION";
  }


  /* ---------------------------------------------------------
     Save Result
     --------------------------------------------------------- */

  state.result = {
    config,
    scope,
    vrichIndex,
    jstIndex,
    comboMap,
    componentUsage,
    outputScope,
    updateRows,
    auditRows,
    issues,
    activeIssues,
    duplicateVrich,
    excluded,
    directUpdated,
    comboUpdated,
    negativeAvailable,
    status,
  };


  /* ---------------------------------------------------------
     Render
     --------------------------------------------------------- */

  renderSummary();
  renderExpansions();
  renderIssues();

  buildDownloads();
  renderDownloads();

  setRunStatus(status);

  setStatus(
    STATUS_LABELS[status] || status,
    status === "PASS" ||
    status === "PASS_WITH_EXCLUSION"
      ? "ok"
      : status === "BLOCKED"
      ? "warn"
      : "danger"
  );
}

function makeAuditRow(data) {
  const deps = data.dependencies || [];
  return {
    "รหัสที่ระบบจะพิจารณา": data.code,
    "มาจาก Input": (data.targetItem?.inputCodes || []).join(", "),
    "โหมด Scope": (data.targetItem?.modes || []).join(", ") || "exact",
    "แหล่งสต๊อก": data.source || "",
    "สถานะ": data.status || "",
    "vRich เดิม": data.oldQty ?? "",
    "JST จำนวน": data.physicalRaw ?? "",
    "JST จํานวนที่ใช้ได้": data.availableRaw ?? "",
    "vRich ใหม่": data.newQty ?? "",
    "Component": deps.map((d) => `${d.componentCode} x${d.requiredQty}`).join(" | "),
    "Available Component": deps.map((d) => `${d.componentCode}=${d.availableRaw}`).join(" | "),
    "Buildable ต่อ Component": deps.map((d) => `${d.componentCode}=${d.buildableFromComponent}`).join(" | "),
    "Stock exposure อื่นของ Component": deps.filter((d) => d.sharedWith?.length).map((d) => `${d.componentCode}→${d.sharedWith.join(",")}`).join(" | "),
    "คำเตือน": (data.warnings || []).join(" | "),
    "หมายเหตุ": data.message || "",
  };
}

function renderSummary() {
  const result = state.result;
  if (!result) {
    els.summaryGrid.innerHTML = "";
    return;
  }
  const familyExpandedInputs = result.scope.expansions.filter((item) => item.resolution.mode === "family").length;
  const metrics = [
    ["รหัส Input ที่ผู้ใช้ส่ง", result.scope.inputs.length],
    ["Scope หลังขยาย Family", result.outputScope.length],
    ["Input ที่ขยายเป็น Family", familyExpandedInputs],
    ["อัปเดตสินค้าเดี่ยว", result.directUpdated.length],
    ["อัปเดต Combo", result.comboUpdated.length],
    ["รวมแถวที่จะ Import", result.updateRows.length],
    ["Available ติดลบและถูก clamp เป็น 0", result.negativeAvailable.length],
    ["ปัญหาที่ยังต้องตรวจ", result.activeIssues.length],
    ["รหัสที่ผู้ใช้ยืนยันให้ข้าม", result.excluded.length],
    ["สถานะ", STATUS_LABELS[result.status] || result.status],
  ];
  els.summaryGrid.innerHTML = metrics
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderExpansions() {
  const result = state.result;
  if (!result) {
    els.expansionPanel.classList.add("hidden");
    return;
  }
  const rows = result.scope.expansions;
  if (!rows.length) {
    els.expansionPanel.classList.add("hidden");
    return;
  }
  els.expansionPanel.classList.remove("hidden");
  els.expansionTableWrap.innerHTML = `
    <table>
      <thead><tr><th>Input</th><th>โหมด</th><th>Family</th><th>รหัสที่อยู่ใน Scope</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.inputCode)}</td>
            <td>${item.resolution.mode === "family" ? "FAMILY" : "EXACT"}</td>
            <td>${escapeHtml(item.resolution.base || "-")}</td>
            <td>${escapeHtml(item.outputCodes.join(", "))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
}

function renderIssues() {
  const result = state.result;
  if (!result) {
    els.issuePanel.classList.add("hidden");
    return;
  }
  const issueMap = new Map();
  for (const issue of result.issues) issueMap.set(issue.code, issue);
  for (const code of result.excluded) {
    if (!issueMap.has(code)) issueMap.set(code, { code, type: "EXCLUDED", message: "ผู้ใช้ยืนยันให้ข้าม", source: "USER" });
  }
  const rows = [...issueMap.values()];
  if (!rows.length) {
    els.issuePanel.classList.add("hidden");
    els.issueTableWrap.innerHTML = "";
    return;
  }
  els.issuePanel.classList.remove("hidden");
  els.issueTableWrap.innerHTML = `
    <table>
      <thead>
        <tr><th>ข้าม</th><th>รหัส</th><th>ประเภท</th><th>แหล่ง</th><th>รายละเอียด</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const checked = state.excludedCodes.has(row.code) ? "checked" : "";
          return `
            <tr>
              <td><input type="checkbox" data-exclude-code="${escapeHtml(row.code)}" ${checked}></td>
              <td>${escapeHtml(row.code)}</td>
              <td>${escapeHtml(row.type)}</td>
              <td>${escapeHtml(row.source || "-")}</td>
              <td>${escapeHtml(row.message || "")}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function sheetFromRows(rows, headers) {
  const matrix = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  return XLSX.utils.aoa_to_sheet(matrix);
}

function sheetFromObjects(rows, headers) {
  if (!rows.length) return XLSX.utils.aoa_to_sheet([headers]);
  return XLSX.utils.json_to_sheet(rows, { header: headers });
}

function downloadWorkbook(filename, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, sheet] of sheets) XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return { filename, url: URL.createObjectURL(blob) };
}

function buildDownloads() {
  for (const item of state.downloads) URL.revokeObjectURL(item.url);
  state.downloads = [];
  const result = state.result;
  if (!result) return;

  const summaryRows = [
    { รายการ: "สถานะ", ค่า: result.status },
    { รายการ: "คำอธิบายสถานะ", ค่า: STATUS_LABELS[result.status] || result.status },
    { รายการ: "กฎ Scope", ค่า: "อัปเดตเฉพาะรหัสที่มาจาก Input หรือรหัส Family ที่ขยายจาก Input เท่านั้น; Component ของ Combo ใช้อ่านเพื่อคำนวณ ไม่ถูกอัปเดต" },
    { รายการ: "แหล่งจำนวนสินค้าเดี่ยว", ค่า: result.config.jstAvailableQtyColumn },
    { รายการ: "Family Expansion", ค่า: result.config.familyExpansionEnabled ? "ON" : "OFF" },
    { รายการ: "Shared Combo Policy", ค่า: result.config.sharedComboPolicy },
    { รายการ: "Input Codes", ค่า: result.scope.inputs.length },
    { รายการ: "Output Scope", ค่า: result.outputScope.length },
    { รายการ: "Direct Updated", ค่า: result.directUpdated.length },
    { รายการ: "Combo Updated", ค่า: result.comboUpdated.length },
    { รายการ: "Import Rows", ค่า: result.updateRows.length },
    { รายการ: "Active Issues", ค่า: result.activeIssues.length },
    { รายการ: "Excluded", ค่า: result.excluded.join(", ") || "-" },
  ];

  const expansionRows = result.scope.expansions.map((item) => ({
    "Input": item.inputCode,
    "โหมด": item.resolution.mode,
    "Family": item.resolution.base || "",
    "Output Scope": item.outputCodes.join(", "),
    "หมายเหตุ": item.resolution.reason || "",
  }));

  const issueRows = result.issues.map((item) => ({
    "รหัส": item.code,
    "ประเภท": item.type,
    "แหล่ง": item.source || "",
    "มาจาก Input": (item.inputCodes || []).join(", "),
    "รายละเอียด": item.message || "",
    "ถูกข้ามโดยผู้ใช้": state.excludedCodes.has(item.code) ? "YES" : "NO",
  }));

  state.downloads.push(downloadWorkbook("vrich_import_update_qty.xlsx", [["Sheet1", sheetFromRows(result.updateRows, state.tables.vrich.headers)]]));
  state.downloads.push(downloadWorkbook("summary_report.xlsx", [["summary", sheetFromObjects(summaryRows, ["รายการ", "ค่า"])]]));
  state.downloads.push(downloadWorkbook("stock_audit_report.xlsx", [["audit", sheetFromObjects(result.auditRows, Object.keys(makeAuditRow({})))]]));
  state.downloads.push(downloadWorkbook("scope_family_report.xlsx", [["scope", sheetFromObjects(expansionRows, ["Input", "โหมด", "Family", "Output Scope", "หมายเหตุ"])]]));
  state.downloads.push(downloadWorkbook("issues_report.xlsx", [["issues", sheetFromObjects(issueRows, ["รหัส", "ประเภท", "แหล่ง", "มาจาก Input", "รายละเอียด", "ถูกข้ามโดยผู้ใช้"])]]));
}

function renderDownloads() {
  if (!state.downloads.length) {
    els.downloadPanel.classList.add("hidden");
    els.downloadList.innerHTML = "";
    return;
  }
  els.downloadPanel.classList.remove("hidden");
  const labels = {
    "vrich_import_update_qty.xlsx": "ไฟล์สำหรับนำเข้า vRich",
    "summary_report.xlsx": "รายงานสรุปผล",
    "stock_audit_report.xlsx": "Audit รายรหัส: ก่อน/หลัง/แหล่งสต๊อก/Component",
    "scope_family_report.xlsx": "รายงาน Input และ Family ที่ถูกขยาย",
    "issues_report.xlsx": "รายงานรายการที่ระบบบล็อก/ไม่พบ/ซ้ำ",
  };
  els.downloadList.innerHTML = state.downloads
    .map((item) => `<a href="${item.url}" download="${escapeHtml(item.filename)}"><span>${escapeHtml(labels[item.filename] || "ดาวน์โหลดไฟล์")}</span><small>${escapeHtml(item.filename)}</small></a>`)
    .join("");
}

function clearResults() {
  state.tables = null;
  state.result = null;
  state.excludedCodes.clear();
  for (const item of state.downloads) URL.revokeObjectURL(item.url);
  state.downloads = [];
  els.processButton.disabled = true;
  els.preflightGrid.innerHTML = "";
  els.summaryGrid.innerHTML = "";
  els.issueTableWrap.innerHTML = "";
  els.expansionTableWrap.innerHTML = "";
  els.downloadList.innerHTML = "";
  els.issuePanel.classList.add("hidden");
  els.expansionPanel.classList.add("hidden");
  els.downloadPanel.classList.add("hidden");
  els.statusPanel.className = "status-panel";
  els.statusPanel.textContent = "";
  setRunStatus("IDLE");
}

function bindFileInput(input, kind) {
  input.addEventListener("change", () => {
    state.files[kind] = input.files[0] || null;
    updateFileLabel(kind, state.files[kind]);
    clearResults();
  });
}

bindFileInput(els.vrichFile, "vrich");
bindFileInput(els.jstFile, "jst");
bindFileInput(els.comboFile, "combo");
bindFileInput(els.targetFile, "target");

els.inspectButton.addEventListener("click", () => {
  runLoadingTask(
    { button: els.inspectButton, busyText: "กำลังตรวจสอบ...", title: "กำลังตรวจสอบไฟล์", message: "กำลังตรวจสอบไฟล์ กรุณารอสักครู่..." },
    inspectFiles
  );
});

els.processButton.addEventListener("click", () => {
  runLoadingTask(
    { button: els.processButton, busyText: "กำลังประมวลผล...", title: "กำลังประมวลผล", message: "กำลังคำนวณสต๊อกพร้อมขายและ Combo..." },
    async () => {
      await waitForPaint();
      processData();
    }
  );
});

els.applyExclusionsButton.addEventListener("click", () => {
  runLoadingTask(
    { button: els.applyExclusionsButton, busyText: "กำลังยืนยัน...", title: "กำลังประมวลผล", message: "กำลังประมวลผลหลังยืนยันรายการที่ข้าม..." },
    async () => {
      const checks = els.issueTableWrap.querySelectorAll("[data-exclude-code]");
      state.excludedCodes.clear();
      checks.forEach((check) => {
        if (check.checked) state.excludedCodes.add(check.dataset.excludeCode);
      });
      await waitForPaint();
      processData();
    }
  );
});

els.clearButton.addEventListener("click", clearResults);

els.downloadList.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  setBusy(true, { title: "กำลังดาวน์โหลดไฟล์", message: "กำลังเตรียมดาวน์โหลดไฟล์ผลลัพธ์..." });
  setTimeout(() => setBusy(false), 450);
});

setRunStatus("IDLE");
