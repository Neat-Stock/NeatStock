(function (global) {
  "use strict";

  const SIZE_SUFFIXES = [
    "10XL", "9XL", "8XL", "7XL", "6XL", "5XL", "4XL", "3XL", "2XL",
    "XXXXXL", "XXXXL", "XXXL", "XXL", "XL", "XS", "S", "M", "L"
  ];
  const SIZE_SUFFIX_SET = new Set(SIZE_SUFFIXES);
  const SHOE_SIZES = ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];
  const SHOE_SIZE_SET = new Set(SHOE_SIZES);

  // Positive and negative evidence keep numeric clothing sizes from being
  // mistaken for shoe families. The matching is intentionally conservative:
  // if a row cannot be confirmed as footwear, the system falls back to EXACT.
  const SHOE_POSITIVE_PATTERN = new RegExp(
    [
      "รองเท้า",
      "SHOES?", "SANDALS?", "SNEAKERS?", "SLIDES?", "CLOGS?", "BOOTS?",
      "LOAFERS?", "HEELS?", "FLIP\\s*-?\\s*FLOPS?", "SLIPPERS?", "MULES?",
      "TRAINERS?", "ESPADRILLES?", "SLINGBACK", "PUMPS?", "FOOTWEAR",
      "BIRKENSTOCK", "CROCS", "SABOT", "BALLERINA", "MARY\\s+JANE",
      "AIR\\s+ZOOM", "NEW\\s+BALANCE"
    ].join("|"),
    "iu"
  );
  const SHOE_NEGATIVE_PATTERN = new RegExp(
    [
      "กางเกง", "เสื้อ", "กระโปรง", "แจ็คเก็ต", "ชุดเดรส",
      "JACKETS?", "JEANS?", "TROUSERS?", "PANTS?", "DENIM",
      "เอว", "สะโพก", "สพ\\.?", "อก\\s*\\d"
    ].join("|"),
    "iu"
  );

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

  function normalizeHeaderName(value) {
    return String(value ?? "")
      .replace(/\ufeff/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[\s_\-]+/g, "")
      .trim()
      .toUpperCase();
  }

  function isDescriptionHeader(header) {
    const normalized = normalizeHeaderName(header);
    return (
      normalized.includes("รายละเอียด") ||
      normalized.includes("ชื่อสินค้า") ||
      normalized === "ชื่อ" ||
      normalized.includes("DESCRIPTION") ||
      normalized.includes("PRODUCTNAME") ||
      normalized.includes("ITEMNAME")
    );
  }

  function isShoeContextHeader(header) {
    const normalized = normalizeHeaderName(header);
    return (
      isDescriptionHeader(header) ||
      normalized.includes("ประเภทสินค้า") ||
      normalized.includes("กลุ่มสินค้า") ||
      normalized.includes("หมวดหมู่") ||
      normalized.includes("CATEGORY") ||
      normalized.includes("PRODUCTTYPE")
    );
  }

  function isStockCodeHeader(header) {
    const normalized = normalizeHeaderName(header);
    return (
      normalized.includes("รหัสสต็อก") ||
      normalized.includes("รหัสสต๊อก") ||
      normalized.includes("รหัสสต็อค") ||
      normalized.includes("รหัสสต๊อค") ||
      normalized.includes("STOCKCODE") ||
      normalized.includes("STOCKSKU")
    );
  }

  function isExplicitSizeHeader(header) {
    const normalized = normalizeHeaderName(header);
    return ["ไซส์", "ไซซ์", "ขนาด", "SIZE", "SHOESIZE"].includes(normalized);
  }

  function valuesForHeaders(row, matcher) {
    const values = [];
    for (const [header, value] of Object.entries(row || {})) {
      if (!matcher(header)) continue;
      const text = String(value ?? "").trim();
      if (text) values.push(text);
    }
    return values;
  }

  function parseShoeSizedCode(value) {
    const code = normalizeCode(value);
    const match = code.match(/^(.*?)(3[6-9]|4[0-5])$/u);
    if (!match) return null;
    const base = match[1];
    const size = match[2];
    if (!SHOE_SIZE_SET.has(size)) return null;
    // Numeric-only identifiers are too risky to expand automatically.
    if (!base || !/[A-Zก-๙]/iu.test(base)) return null;
    return { code, base, size };
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function shoeSizeMarkerPattern(size, global = false) {
    const escaped = escapeRegExp(size);
    return new RegExp(
      `(?:\\(|\\[)?\\s*(?:SIZE|ไซส์|ไซซ์|ไซส|เบอร์)\\s*[:#]?\\s*${escaped}(?:\\.5)?` +
        `(?!\\s*[-–]\\s*\\d)\\s*(?:\\)|\\])?`,
      global ? "giu" : "iu"
    );
  }

  function normalizeComparableText(value) {
    let text = String(value ?? "");
    if (typeof text.normalize === "function") text = text.normalize("NFKC");
    return text
      .replace(/&NBSP;?/giu, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[\ufeff\u200b\u200c\u200d\u2060]/g, "")
      .toUpperCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim();
  }

  function descriptionCore(text, size) {
    const pattern = shoeSizeMarkerPattern(size, true);
    if (!pattern.test(String(text ?? ""))) return "";
    pattern.lastIndex = 0;
    const withoutSize = String(text ?? "").replace(pattern, " ");
    return normalizeComparableText(withoutSize);
  }

  function diceSimilarity(left, right) {
    const a = normalizeComparableText(left);
    const b = normalizeComparableText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const counts = new Map();
    for (let index = 0; index < a.length - 1; index += 1) {
      const pair = a.slice(index, index + 2);
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }

    let intersection = 0;
    for (let index = 0; index < b.length - 1; index += 1) {
      const pair = b.slice(index, index + 2);
      const count = counts.get(pair) || 0;
      if (!count) continue;
      intersection += 1;
      counts.set(pair, count - 1);
    }

    return (2 * intersection) / (a.length - 1 + b.length - 1);
  }

  function compactCode(value) {
    return normalizeCode(value).replace(/[^A-Z0-9ก-๙]+/giu, "");
  }

  function hasStructuredStockCode(row, base, size, saleCode) {
    const compactSale = compactCode(saleCode);
    const compactBase = compactCode(base);
    for (const stockCode of valuesForHeaders(row, isStockCodeHeader)) {
      const normalized = normalizeCode(stockCode);
      const compactStock = compactCode(normalized);
      if (compactStock !== compactSale) continue;

      const separated = normalized.match(/^(.*?)[\s_\-]+(3[6-9]|4[0-5])$/u);
      if (!separated || separated[2] !== size) continue;
      if (compactCode(separated[1]) === compactBase) return true;
    }
    return false;
  }

  function explicitSizeMatches(row, size) {
    for (const value of valuesForHeaders(row, isExplicitSizeHeader)) {
      const number = toFiniteNumber(value);
      if (number === null) continue;
      if (Math.floor(number) === Number(size) && number < Number(size) + 1) return true;
    }
    return false;
  }

  function shoeEvidenceForRow(row, codeInfo) {
    const contextTexts = valuesForHeaders(row, isShoeContextHeader);
    const descriptionTexts = valuesForHeaders(row, isDescriptionHeader);
    const context = contextTexts.join(" ");
    const positive = SHOE_POSITIVE_PATTERN.test(context);
    const negative = SHOE_NEGATIVE_PATTERN.test(context);
    const markerTexts = descriptionTexts.filter((text) => shoeSizeMarkerPattern(codeInfo.size).test(text));
    const markerMatch = markerTexts.length > 0;
    const sizeColumnMatch = explicitSizeMatches(row, codeInfo.size);
    const structuredStock = hasStructuredStockCode(row, codeInfo.base, codeInfo.size, codeInfo.code);
    const core = markerTexts.map((text) => descriptionCore(text, codeInfo.size)).find(Boolean) || "";

    let classification = "unknown";
    if (negative) classification = "non_shoe";
    else if (positive) classification = "shoe";

    return {
      markerMatch,
      sizeColumnMatch,
      structuredStock,
      classification,
      core,
      validSizeEvidence: markerMatch || sizeColumnMatch,
    };
  }

  function bestShoeEvidence(rows, codeInfo, reference = null) {
    const evidence = (rows || [])
      .map((row) => shoeEvidenceForRow(row, codeInfo))
      .filter((item) => item.validSizeEvidence && item.classification !== "non_shoe");

    if (!evidence.length) return null;

    const ranked = evidence
      .map((item) => {
        const similarity = reference && item.core && reference.core
          ? diceSimilarity(reference.core, item.core)
          : item.core ? 1 : 0;
        const score =
          (item.classification === "shoe" ? 100 : 0) +
          (item.structuredStock ? 20 : 0) +
          (item.markerMatch ? 10 : 0) +
          similarity;
        return { ...item, similarity, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!reference) return ranked[0];

    return ranked.find((item) => {
      if (item.classification === "unknown" && !item.structuredStock) return false;
      if (reference.core && item.core) {
        if (item.similarity >= 0.88) return true;
        // Structured stock codes are strong supporting evidence, but still
        // require the product descriptions to be recognizably related.
        if (reference.structuredStock && item.structuredStock && item.similarity >= 0.72) return true;
        return false;
      }
      return reference.structuredStock && item.structuredStock;
    }) || null;
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

  function resolveApparelFamily(code, vrichIndex, supportSets = []) {
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
    if (!candidates.length) return { mode: "exact", code: normalized, reason: "NO_CONFIDENT_APPAREL_FAMILY" };
    candidates.sort((a, b) => b.score - a.score || b.base.length - a.base.length);
    const best = candidates[0];
    const second = candidates[1];
    if (second && second.score === best.score && second.base !== best.base) {
      return { mode: "exact", code: normalized, reason: "AMBIGUOUS_APPAREL_FAMILY", candidates };
    }
    return {
      mode: "family",
      familyType: "apparel",
      code: normalized,
      base: best.base,
      members: best.members,
      suffix: best.suffix,
      candidates,
      reason: "SAFE_APPAREL_FAMILY",
    };
  }

  function resolveShoeFamily(code, vrichIndex, supportSets = []) {
    const codeInfo = parseShoeSizedCode(code);
    const normalized = normalizeCode(code);
    if (!codeInfo) return { mode: "exact", code: normalized, reason: "NO_SHOE_SIZE_SUFFIX" };

    const inputRows = vrichIndex.get(normalized) || [];
    const reference = bestShoeEvidence(inputRows, codeInfo);
    if (!reference) {
      return { mode: "exact", code: normalized, reason: "NO_CONFIDENT_SHOE_EVIDENCE" };
    }
    if (reference.classification === "unknown" && !reference.structuredStock) {
      return { mode: "exact", code: normalized, reason: "UNCONFIRMED_SHOE_PRODUCT" };
    }

    const members = [];
    const evidenceByCode = {};
    let support = 0;

    for (const candidateCode of vrichIndex.keys()) {
      const candidateInfo = parseShoeSizedCode(candidateCode);
      if (!candidateInfo || candidateInfo.base !== codeInfo.base) continue;
      const candidateEvidence = bestShoeEvidence(
        vrichIndex.get(candidateCode) || [],
        candidateInfo,
        reference
      );
      if (!candidateEvidence) continue;
      members.push(candidateCode);
      evidenceByCode[candidateCode] = {
        classification: candidateEvidence.classification,
        structuredStock: candidateEvidence.structuredStock,
        similarity: candidateEvidence.similarity,
      };
      if (supportSets.some((set) => set && set.has(candidateCode))) support += 1;
    }

    const uniqueMembers = [...new Set(members)].sort((left, right) => {
      const leftInfo = parseShoeSizedCode(left);
      const rightInfo = parseShoeSizedCode(right);
      return Number(leftInfo?.size || 0) - Number(rightInfo?.size || 0) ||
        left.localeCompare(right, undefined, { numeric: true });
    });

    if (uniqueMembers.length < 2 || !uniqueMembers.includes(normalized)) {
      return {
        mode: "exact",
        code: normalized,
        reason: "NO_CONFIDENT_SHOE_FAMILY",
        base: codeInfo.base,
        candidates: uniqueMembers,
      };
    }

    return {
      mode: "family",
      familyType: "shoe",
      code: normalized,
      base: codeInfo.base,
      members: uniqueMembers,
      suffix: codeInfo.size,
      support,
      evidenceByCode,
      shoeSizeRange: `${SHOE_SIZES[0]}-${SHOE_SIZES[SHOE_SIZES.length - 1]}`,
      reason: "SAFE_SHOE_FAMILY",
    };
  }

  function resolveFamily(code, vrichIndex, supportSets = []) {
    const normalized = normalizeCode(code);
    const apparel = resolveApparelFamily(normalized, vrichIndex, supportSets);
    if (apparel.mode === "family") return apparel;

    const shoe = resolveShoeFamily(normalized, vrichIndex, supportSets);
    if (shoe.mode === "family") return shoe;

    if (apparel.reason === "AMBIGUOUS_APPAREL_FAMILY") return apparel;
    if (parseShoeSizedCode(normalized)) return shoe;
    return apparel;
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
    SHOE_SIZES,
    normalizeCode,
    toFiniteNumber,
    buildIndex,
    orderedCodes,
    buildComboMap,
    parseShoeSizedCode,
    resolveShoeFamily,
    resolveFamily,
    expandTargets,
    buildActiveComponentUsage,
    resolveStockForCode,
  };
})(typeof window !== "undefined" ? window : globalThis);
