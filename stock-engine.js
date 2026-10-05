(function (global) {
  "use strict";

  const SIZE_SUFFIXES = [
    "10XL", "9XL", "8XL", "7XL", "6XL", "5XL", "4XL", "3XL", "2XL",
    "XXXXXL", "XXXXL", "XXXL", "XXL", "XL", "XS", "S", "M", "L"
  ];
  const SIZE_SUFFIX_SET = new Set(SIZE_SUFFIXES);

  function normalizeCode(value) {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (["nan", "none", "nat"].includes(text.toLowerCase())) return "";
    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[\ufeff\u200b\u200c\u200d\u2060]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^.+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
    return text.toUpperCase();
  }

  function toFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).replace(/,/g, "").trim();
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function buildIndex(rows, column) {
    const index = new Map();
    for (const row of rows) {
      const code = normalizeCode(row[column]);
      if (!code) continue;
      if (!index.has(code)) index.set(code, []);
      index.get(code).push(row);
    }
    return index;
  }

  function orderedCodes(rows, column) {
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const code = normalizeCode(row[column]);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      result.push({ code, raw: row[column] });
    }
    return result;
  }

  function buildComboMap(rows, config) {
    const map = new Map();
    for (const row of rows) {
      const comboCode = normalizeCode(row[config.comboCodeColumn]);
      if (!comboCode) continue;
      const componentCode = normalizeCode(row[config.comboComponentColumn]);
      const requiredQty = toFiniteNumber(row[config.comboRequiredQtyColumn]);
      if (!map.has(comboCode)) map.set(comboCode, []);
      map.get(comboCode).push({ comboCode, componentCode, requiredQty, raw: row });
    }
    return map;
  }

  function familyMembersForBase(base, vrichIndex) {
    const members = [];
    for (const code of vrichIndex.keys()) {
      if (!code.startsWith(base) || code.length <= base.length) continue;
      const suffix = code.slice(base.length);
      if (SIZE_SUFFIX_SET.has(suffix)) members.push(code);
    }
    return [...new Set(members)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function resolveFamily(code, vrichIndex, supportSets = []) {
    const normalized = normalizeCode(code);
    const candidates = [];
    for (const suffix of SIZE_SUFFIXES) {
      if (!normalized.endsWith(suffix) || normalized.length <= suffix.length) continue;
      const base = normalized.slice(0, -suffix.length);
      if (!base || !/\d/.test(base)) continue;
      const members = familyMembersForBase(base, vrichIndex);
      if (members.length < 2 || !members.includes(normalized)) continue;
      let support = 0;
      for (const member of members) {
        if (supportSets.some((set) => set && set.has(member))) support += 1;
      }
      candidates.push({ base, suffix, members, support, score: members.length * 1000 + support });
    }
    if (!candidates.length) return { mode: "exact", code: normalized, reason: "NO_CONFIDENT_FAMILY" };
    candidates.sort((a, b) => b.score - a.score || b.base.length - a.base.length);
    const best = candidates[0];
    const second = candidates[1];
    if (second && second.score === best.score && second.base !== best.base) {
      return { mode: "exact", code: normalized, reason: "AMBIGUOUS_FAMILY", candidates };
    }
    return { mode: "family", code: normalized, base: best.base, members: best.members, suffix: best.suffix, candidates };
  }

  function expandTargets(targetRows, targetCodeColumn, vrichIndex, supportSets, enabled) {
    const inputs = orderedCodes(targetRows, targetCodeColumn);
    const outputMap = new Map();
    const expansions = [];

    for (const input of inputs) {
      const resolution = enabled
        ? resolveFamily(input.code, vrichIndex, supportSets)
        : { mode: "exact", code: input.code, reason: "FAMILY_EXPANSION_DISABLED" };
      const codes = resolution.mode === "family" ? resolution.members : [input.code];
      expansions.push({ inputCode: input.code, raw: input.raw, resolution, outputCodes: codes });
      for (const code of codes) {
        if (!outputMap.has(code)) outputMap.set(code, { code, inputCodes: [], modes: [] });
        const item = outputMap.get(code);
        if (!item.inputCodes.includes(input.code)) item.inputCodes.push(input.code);
        if (!item.modes.includes(resolution.mode)) item.modes.push(resolution.mode);
      }
    }
    return { inputs, outputs: [...outputMap.values()], expansions };
  }

  function aggregateComboLines(lines) {
    const required = new Map();
    const invalid = [];
    for (const line of lines || []) {
      if (!line.componentCode || line.requiredQty === null || line.requiredQty <= 0) {
        invalid.push(line);
        continue;
      }
      required.set(line.componentCode, (required.get(line.componentCode) || 0) + line.requiredQty);
    }
    return { required, invalid };
  }

  function buildActiveComponentUsage(comboMap, vrichIndex, vrichQtyColumn, targetScopeSet) {
    const usage = new Map();
    const allComponents = new Set();

    // Exposure from other Combo SKUs that currently have stock in vRich or are in this run's output scope.
    for (const [comboCode, lines] of comboMap.entries()) {
      const { required } = aggregateComboLines(lines);
      for (const componentCode of required.keys()) allComponents.add(componentCode);

      const vrichRows = vrichIndex.get(comboCode) || [];
      if (vrichRows.length !== 1) continue;
      const current = toFiniteNumber(vrichRows[0][vrichQtyColumn]) || 0;
      const isActive = current > 0 || targetScopeSet.has(comboCode);
      if (!isActive) continue;
      for (const componentCode of required.keys()) {
        if (!usage.has(componentCode)) usage.set(componentCode, new Set());
        usage.get(componentCode).add(`COMBO:${comboCode}`);
      }
    }

    // Exposure from the component being sold directly in vRich.
    // If direct stock is > 0 (or the direct SKU is also in this run's scope), allocating the same physical stock
    // to a Combo would double count inventory unless the user explicitly chooses theoretical mode.
    for (const componentCode of allComponents) {
      const rows = vrichIndex.get(componentCode) || [];
      if (rows.length !== 1) continue;
      const current = toFiniteNumber(rows[0][vrichQtyColumn]) || 0;
      if (current > 0 || targetScopeSet.has(componentCode)) {
        if (!usage.has(componentCode)) usage.set(componentCode, new Set());
        usage.get(componentCode).add(`DIRECT:${componentCode}`);
      }
    }

    return usage;
  }

  function resolveStockForCode(options) {
    const {
      code,
      jstIndex,
      comboMap,
      componentUsage,
      jstAvailableColumn,
      jstPhysicalColumn,
      sharedPolicy = "block",
    } = options;

    const directRows = jstIndex.get(code) || [];
    const comboLines = comboMap.get(code) || [];
    const hasDirect = directRows.length > 0;
    const hasCombo = comboLines.length > 0;

    if (hasDirect && hasCombo) {
      return {
        code,
        status: "AMBIGUOUS_SOURCE",
        source: "AMBIGUOUS",
        message: "รหัสนี้พบทั้งใน JST Item และ JST Combo จึงไม่เลือกแหล่งสต๊อกให้อัตโนมัติ",
      };
    }

    if (hasDirect) {
      if (directRows.length !== 1) {
        return { code, status: "DUPLICATE_JST", source: "DIRECT", message: `พบรหัสซ้ำใน JST Item ${directRows.length} แถว` };
      }
      const row = directRows[0];
      const availableRaw = toFiniteNumber(row[jstAvailableColumn]);
      const physicalRaw = jstPhysicalColumn ? toFiniteNumber(row[jstPhysicalColumn]) : null;
      if (availableRaw === null) {
        return { code, status: "INVALID_AVAILABLE", source: "DIRECT", message: `ค่า ${jstAvailableColumn} ไม่ใช่ตัวเลข` };
      }
      const warnings = [];
      const quantity = Math.max(0, Math.floor(availableRaw));
      if (availableRaw < 0) warnings.push(`JST Available ติดลบ (${availableRaw}) จึงปรับค่าที่ส่ง vRich เป็น 0`);
      return {
        code,
        status: "OK",
        source: "DIRECT",
        quantity,
        availableRaw,
        physicalRaw,
        warnings,
        dependencies: [],
      };
    }

    if (hasCombo) {
      const { required, invalid } = aggregateComboLines(comboLines);
      if (invalid.length || !required.size) {
        return { code, status: "INVALID_COMBO", source: "COMBO", message: "สูตร Combo มีรหัสส่วนประกอบหรือจำนวนที่ใช้ไม่ถูกต้อง" };
      }

      const dependencies = [];
      let buildable = Infinity;
      const warnings = [];
      const sharedComponents = [];

      for (const [componentCode, requiredQty] of required.entries()) {
        const componentRows = jstIndex.get(componentCode) || [];
        if (!componentRows.length) {
          return {
            code,
            status: "MISSING_COMPONENT",
            source: "COMBO",
            message: `ไม่พบ Component ${componentCode} ใน JST Item`,
            missingComponent: componentCode,
          };
        }
        if (componentRows.length !== 1) {
          return {
            code,
            status: "DUPLICATE_COMPONENT",
            source: "COMBO",
            message: `Component ${componentCode} ซ้ำใน JST Item ${componentRows.length} แถว`,
            duplicateComponent: componentCode,
          };
        }
        const row = componentRows[0];
        const availableRaw = toFiniteNumber(row[jstAvailableColumn]);
        const physicalRaw = jstPhysicalColumn ? toFiniteNumber(row[jstPhysicalColumn]) : null;
        if (availableRaw === null) {
          return {
            code,
            status: "INVALID_COMPONENT_AVAILABLE",
            source: "COMBO",
            message: `ค่า ${jstAvailableColumn} ของ Component ${componentCode} ไม่ใช่ตัวเลข`,
          };
        }
        const available = Math.max(0, Math.floor(availableRaw));
        if (availableRaw < 0) warnings.push(`${componentCode} Available ติดลบ (${availableRaw}) จึงใช้ 0 ในการคำนวณ`);
        const sets = Math.floor(available / requiredQty);
        buildable = Math.min(buildable, sets);
        const usedBy = [...(componentUsage.get(componentCode) || new Set())].filter((exposure) => exposure !== `COMBO:${code}`);
        if (usedBy.length) sharedComponents.push({ componentCode, usedBy });
        dependencies.push({ componentCode, requiredQty, physicalRaw, availableRaw, available, buildableFromComponent: sets, sharedWith: usedBy });
      }

      if (sharedComponents.length && sharedPolicy === "block") {
        const detail = sharedComponents
          .map((item) => `${item.componentCode} → ${item.usedBy.slice(0, 5).join(", ")}${item.usedBy.length > 5 ? "..." : ""}`)
          .join("; ");
        return {
          code,
          status: "SHARED_COMPONENT",
          source: "COMBO",
          quantity: Number.isFinite(buildable) ? buildable : 0,
          dependencies,
          warnings,
          sharedComponents,
          message: `Combo ใช้ Component ร่วมกับ Combo อื่นที่ยังมี exposure ใน vRich: ${detail}`,
        };
      }

      if (sharedComponents.length) warnings.push("Combo นี้มี Component ร่วมกับ Combo อื่น จำนวนที่คำนวณเป็น theoretical buildable และอาจเกิด double counting");
      return {
        code,
        status: "OK",
        source: "COMBO",
        quantity: Number.isFinite(buildable) ? Math.max(0, buildable) : 0,
        dependencies,
        warnings,
        sharedComponents,
      };
    }

    return { code, status: "MISSING_JST", source: "NONE", message: "ไม่พบรหัสใน JST Item และ JST Combo" };
  }

  global.StockEngine = {
    SIZE_SUFFIXES,
    normalizeCode,
    toFiniteNumber,
    buildIndex,
    orderedCodes,
    buildComboMap,
    resolveFamily,
    expandTargets,
    buildActiveComponentUsage,
    resolveStockForCode,
  };
})(typeof window !== "undefined" ? window : globalThis);
