/**
 * Extracteur de texte PDF minimaliste, sans dépendance (pako pour inflate).
 *
 * Suffisant pour les PDF générés par l'extranet CROUS (avis d'échéance) :
 * flux FlateDecode ou non compressés, opérateurs texte Tj / ' / TJ, polices
 * simples (latin1) ou CID avec table /ToUnicode (cas des avis d'échéance :
 * les chaînes contiennent des index de glyphes sur 2 octets, traduits en
 * caractères via la CMap ToUnicode embarquée).
 *
 * S'exécute dans le content script. On a d'abord essayé pdf.js puis un
 * background avec DecompressionStream : les deux déclenchaient des erreurs
 * Xray en WebExtension Firefox (« Permission denied to access property
 * ... »). D'où : pako et aucune API exotique.
 */
globalThis.CiteURV = globalThis.CiteURV || {};

globalThis.CiteURV.pdfText = (() => {
  /**
   * Octets -> chaîne binaire (1 octet = 1 charCode, fidèle).
   * Surtout PAS TextDecoder('latin1') : c'est en réalité du windows-1252,
   * qui remappe les octets 0x80-0x9F et corrompt les codes de glyphes.
   */
  function toBinaryString(bytes) {
    const chunkSize = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return s;
  }

  /** Décompresse un flux FlateDecode (zlib, avec repli deflate brut). */
  function inflate(bytes) {
    try {
      return pako.inflate(bytes);
    } catch (_error) {
      try {
        return pako.inflateRaw(bytes);
      } catch (_error2) {
        return null;
      }
    }
  }

  /** Déséchappe une chaîne PDF littérale ; retourne un tableau d'octets. */
  function decodePdfStringBytes(body) {
    const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    const out = [];
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') {
        out.push(body.charCodeAt(i));
        continue;
      }
      const next = body[i + 1];
      if (next === '\r' || next === '\n') {
        // continuation de ligne
        i += next === '\r' && body[i + 2] === '\n' ? 2 : 1;
      } else if (/\d/.test(next)) {
        const octal = body.slice(i + 1).match(/^\d{1,3}/)[0];
        out.push(parseInt(octal, 8) & 0xff);
        i += octal.length;
      } else if (escapes[next] !== undefined) {
        out.push(escapes[next]);
        i += 1;
      } else {
        out.push(body.charCodeAt(i + 1));
        i += 1;
      }
    }
    return out;
  }

  /** "<48656C>" (contenu hex) -> tableau d'octets. */
  function hexToBytes(hex) {
    const clean = hex.replace(/\s/g, '');
    const out = [];
    for (let i = 0; i + 1 < clean.length; i += 2) {
      out.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return out;
  }

  /** Hex UTF-16BE ("0043" ou "00470041") -> chaîne Unicode. */
  function utf16beHexToString(hex) {
    let s = '';
    for (let i = 0; i + 3 < hex.length; i += 4) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    return s;
  }

  /**
   * Parse une CMap /ToUnicode (bfchar + bfrange).
   * Retourne { codeLen, map: Map<codeNum, string> }.
   */
  function parseToUnicodeCMap(cmapText) {
    const map = new Map();
    let codeLen = 2;
    const space = cmapText.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
    if (space) codeLen = Math.ceil(space[1].length / 2);

    for (const block of cmapText.matchAll(/beginbfchar([^]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(pair[1], 16), utf16beHexToString(pair[2]));
      }
    }
    for (const block of cmapText.matchAll(/beginbfrange([^]*?)endbfrange/g)) {
      const entry =
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[((?:\s*<[0-9A-Fa-f]+>)+)\s*\])/g;
      for (const m of block[1].matchAll(entry)) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        if (m[3] !== undefined) {
          const base = utf16beHexToString(m[3]);
          for (let c = lo; c <= hi; c++) {
            const shifted =
              base.slice(0, -1) +
              String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo));
            map.set(c, shifted);
          }
        } else {
          const targets = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
          for (let c = lo; c <= hi && c - lo < targets.length; c++) {
            map.set(c, utf16beHexToString(targets[c - lo][1]));
          }
        }
      }
    }
    return { codeLen, map };
  }

  /** Traduit les octets d'une chaîne affichée selon la police courante. */
  function bytesToText(strBytes, font) {
    if (!font) {
      // police simple : 1 octet = 1 caractère (~WinAnsi/latin1)
      return String.fromCharCode(...strBytes);
    }
    const { codeLen, map } = font;
    let s = '';
    for (let i = 0; i + codeLen - 1 < strBytes.length; i += codeLen) {
      let code = 0;
      for (let j = 0; j < codeLen; j++) code = (code << 8) | strBytes[i + j];
      const mapped = map.get(code);
      s += mapped !== undefined ? mapped : '';
    }
    return s;
  }

  /**
   * Extrait le texte d'un flux de contenu, dans l'ordre, en suivant la
   * police courante (opérateur Tf). Les morceaux d'un même tableau TJ
   * (crénage) sont recollés sans espace, les opérateurs séparés d'une espace.
   */
  function textFromContentStream(content, fontsByName) {
    const parts = [];
    let font = null;
    const re =
      /\/([\w.]+)\s+[\d.]+\s+Tf|\(((?:\\[^]|[^\\()])*)\)\s*(?:Tj|')|\[((?:\((?:\\[^]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[^\]])*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*(?:Tj|')/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] !== undefined) {
        font = fontsByName.get(m[1]) || null;
      } else if (m[2] !== undefined) {
        parts.push(bytesToText(decodePdfStringBytes(m[2]), font));
      } else if (m[3] !== undefined) {
        const pieces = [
          ...m[3].matchAll(/\(((?:\\[^]|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>/g)
        ].map((p) =>
          p[1] !== undefined
            ? bytesToText(decodePdfStringBytes(p[1]), font)
            : bytesToText(hexToBytes(p[2]), font)
        );
        parts.push(pieces.join(''));
      } else if (m[4] !== undefined) {
        parts.push(bytesToText(hexToBytes(m[4]), font));
      }
    }
    return parts.join(' ');
  }

  /**
   * Découpe le PDF en objets indirects : Map<numéro, { dict, data }>.
   * data = contenu du flux, décompressé si FlateDecode (null si illisible).
   */
  function parseObjects(bytes, raw) {
    const objects = new Map();
    for (const m of raw.matchAll(/(\d+)\s+\d+\s+obj\b/g)) {
      const bodyStart = m.index + m[0].length;
      const endObj = raw.indexOf('endobj', bodyStart);
      const body = raw.slice(bodyStart, endObj === -1 ? undefined : endObj);

      const streamKeyword = body.match(/(^|[^d])stream(\r\n|\r|\n)/);
      let dict = body;
      let data = null;
      if (streamKeyword) {
        dict = body.slice(0, streamKeyword.index);
        const dataStart = bodyStart + streamKeyword.index + streamKeyword[0].length;
        const endIndex = raw.indexOf('endstream', dataStart);
        if (endIndex !== -1) {
          let dataEnd = endIndex;
          while (dataEnd > dataStart && (raw[dataEnd - 1] === '\n' || raw[dataEnd - 1] === '\r')) {
            dataEnd--;
          }
          data = bytes.subarray(dataStart, dataEnd);
          if (/\/FlateDecode/.test(dict)) data = inflate(data);
        }
      }
      objects.set(Number(m[1]), { dict, data });
    }
    return objects;
  }

  /**
   * Construit la table nom de ressource -> décodeur de police, à partir de
   * tous les dictionnaires /Font <</F1 5 0 R ...>> du document. Une police
   * sans /ToUnicode est traitée comme simple (1 octet = 1 caractère).
   */
  function buildFontMaps(objects) {
    const fontsByName = new Map();
    const cmapCache = new Map();

    for (const { dict } of objects.values()) {
      for (const fontDict of dict.matchAll(/\/Font\s*<<([^]*?)>>/g)) {
        for (const ref of fontDict[1].matchAll(/\/([\w.]+)\s+(\d+)\s+\d+\s+R/g)) {
          const name = ref[1];
          const fontObj = objects.get(Number(ref[2]));
          if (!fontObj) continue;
          const toUnicode = fontObj.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
          if (!toUnicode) {
            fontsByName.set(name, null); // police simple
            continue;
          }
          const cmapNum = Number(toUnicode[1]);
          if (!cmapCache.has(cmapNum)) {
            const cmapObj = objects.get(cmapNum);
            cmapCache.set(
              cmapNum,
              cmapObj && cmapObj.data ? parseToUnicodeCMap(toBinaryString(cmapObj.data)) : null
            );
          }
          fontsByName.set(name, cmapCache.get(cmapNum));
        }
      }
    }
    return fontsByName;
  }

  /** Texte brut de tout le PDF (Uint8Array ou ArrayBuffer). */
  function extractText(pdfBytes) {
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const raw = toBinaryString(bytes);
    const objects = parseObjects(bytes, raw);
    const fontsByName = buildFontMaps(objects);

    const texts = [];
    for (const { dict, data } of objects.values()) {
      if (data === null) continue;
      if (/\/Subtype\s*\/Image/.test(dict)) continue;
      const content = toBinaryString(data);
      if (/\b(Tj|TJ|BT)\b/.test(content)) {
        texts.push(textFromContentStream(content, fontsByName));
      }
    }
    return texts.join('\n');
  }

  return { extractText, textFromContentStream, parseToUnicodeCMap };
})();
