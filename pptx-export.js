(function (global) {
  var NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  var NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  var BLACK = "000000";
  var MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  var JSZip = global.JSZip;

  function str(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function ctrlEscape(s) {
    return s.replace(/[\u0000-\u0008\u000B-\u001F]/g, function (m) {
      return "_x" + ("000" + m.charCodeAt(0).toString(16).toUpperCase()).slice(-4) + "_";
    });
  }

  function local(c) {
    if (!c) return "";
    return c.localName || (c.nodeName.indexOf(":") > -1 ? c.nodeName.split(":")[1] : c.nodeName);
  }

  function firstEl(el, localName) {
    var c = el.firstChild;
    while (c) {
      if (c.nodeType === 1 && (localName === undefined || local(c) === localName)) return c;
      c = c.nextSibling;
    }
    return null;
  }

  function kids(el, localName) {
    var out = [];
    var c = el.firstChild;
    while (c) {
      if (c.nodeType === 1 && (localName === undefined || local(c) === localName)) out.push(c);
      c = c.nextSibling;
    }
    return out;
  }

  function firstDescendant(el, localName) {
    var stack = [el];
    while (stack.length) {
      var n = stack.pop();
      if (n.nodeType !== 1) continue;
      if (local(n) === localName) return n;
      var c = n.firstChild;
      while (c) {
        stack.push(c);
        c = c.nextSibling;
      }
    }
    return null;
  }

  function createEl(doc, qname) {
    var ns = qname.charAt(0) === "a" ? NS_A : qname.charAt(0) === "p" ? NS_P : NS_R;
    return doc.createElementNS(ns, qname);
  }

  function shapesOf(spTree) {
    var out = [];
    var c = spTree.firstChild;
    while (c) {
      if (c.nodeType === 1) {
        var ln = local(c);
        if (ln === "sp" || ln === "pic" || ln === "graphicFrame" || ln === "cxnSp") out.push(c);
      }
      c = c.nextSibling;
    }
    return out;
  }

  function maxShapeId(shapes) {
    var mx = 0;
    for (var i = 0; i < shapes.length; i++) {
      var cPr = firstDescendant(shapes[i], "cNvPr");
      if (cPr) {
        var v = parseInt(cPr.getAttribute("id"), 10);
        if (!isNaN(v) && v > mx) mx = v;
      }
    }
    return mx;
  }

  function setRunText(run, text) {
    var doc = run.ownerDocument;
    var t = firstEl(run, "t");
    if (!t) {
      t = createEl(doc, "a:t");
      run.appendChild(t);
    }
    t.textContent = ctrlEscape(text);
  }

  function setRunColor(run, color) {
    var doc = run.ownerDocument;
    var rPr = firstEl(run, "rPr");
    if (!rPr) {
      rPr = createEl(doc, "a:rPr");
      run.insertBefore(rPr, run.firstChild);
    }
    rPr.setAttribute("i", "0");
    var solid = firstEl(rPr, "solidFill");
    if (!solid) {
      solid = createEl(doc, "a:solidFill");
      var ref = null;
      var c = rPr.firstChild;
      while (c) {
        if (c.nodeType === 1) {
          var ln = local(c);
          if (ln === "latin" || ln === "ea" || ln === "cs" || ln === "sym") {
            ref = c;
            break;
          }
        }
        c = c.nextSibling;
      }
      rPr.insertBefore(solid, ref);
    }
    var cc = solid.firstChild;
    while (cc) {
      var next = cc.nextSibling;
      if (cc.nodeType === 1) {
        var ln2 = local(cc);
        if (ln2 === "srgbClr" || ln2 === "schemeClr" || ln2 === "sysClr" || ln2 === "hslClr" || ln2 === "prstClr" || ln2 === "scrgbClr") {
          solid.removeChild(cc);
        }
      }
      cc = next;
    }
    var clr = createEl(doc, "a:srgbClr");
    clr.setAttribute("val", color);
    solid.appendChild(clr);
  }

  function setText(shape, text, color) {
    var txBody = firstEl(shape, "txBody");
    if (!txBody) return;
    var ps = kids(txBody, "p");
    var p0 = ps.length ? ps[0] : null;
    for (var i = 1; i < ps.length; i++) txBody.removeChild(ps[i]);
    if (!p0) {
      p0 = createEl(txBody.ownerDocument, "a:p");
      txBody.appendChild(p0);
    }
    var runs = kids(p0, "r");
    for (var j = 0; j < runs.length - 1; j++) p0.removeChild(runs[j]);
    var keep = runs.length ? runs[runs.length - 1] : null;
    if (!keep) {
      keep = createEl(p0.ownerDocument, "a:r");
      p0.appendChild(keep);
    }
    setRunText(keep, text);
    if (color) setRunColor(keep, color);
  }

  function setLines(shape, lines) {
    var txBody = firstEl(shape, "txBody");
    if (!txBody) return;
    var ps = kids(txBody, "p");
    if (!ps.length) return;
    var proto = ps[0].cloneNode(true);
    for (var i = 0; i < ps.length; i++) txBody.removeChild(ps[i]);
    var doc = txBody.ownerDocument;
    for (var k = 0; k < lines.length; k++) txBody.appendChild(proto.cloneNode(true));
    var newPs = kids(txBody, "p");
    for (var m = 0; m < newPs.length; m++) {
      var runs = kids(newPs[m], "r");
      if (!runs.length) continue;
      var last = runs[runs.length - 1];
      setRunText(last, lines[m]);
      setRunColor(last, BLACK);
    }
  }

  function setCell(tc, text, color) {
    var txBody = firstEl(tc, "txBody");
    if (!txBody) return;
    var ps = kids(txBody, "p");
    var p0 = ps.length ? ps[0] : null;
    if (!p0) {
      p0 = createEl(txBody.ownerDocument, "a:p");
      txBody.appendChild(p0);
    }
    for (var i = 1; i < ps.length; i++) txBody.removeChild(ps[i]);
    var runs = kids(p0, "r");
    for (var j = 0; j < runs.length - 1; j++) p0.removeChild(runs[j]);
    var keep = runs.length ? runs[runs.length - 1] : null;
    if (!keep) {
      keep = createEl(p0.ownerDocument, "a:r");
      p0.appendChild(keep);
    }
    setRunText(keep, text);
    if (color) setRunColor(keep, color);
  }

  function emptyPlaceholder(shape) {
    var txBody = firstEl(shape, "txBody");
    var doc = shape.ownerDocument;
    if (txBody) {
      var ps = kids(txBody, "p");
      for (var i = 0; i < ps.length; i++) txBody.removeChild(ps[i]);
      txBody.appendChild(createEl(doc, "a:p"));
    }
    var spPr = firstEl(shape, "spPr");
    if (spPr) {
      var solid = firstEl(spPr, "solidFill");
      if (solid) spPr.replaceChild(createEl(doc, "a:noFill"), solid);
      var ln = firstEl(spPr, "ln");
      if (!ln) {
        ln = createEl(doc, "a:ln");
        var ref = firstEl(spPr, "effectLst") || firstEl(spPr, "scene3d") || null;
        spPr.insertBefore(ln, ref);
      }
      var lnFill = firstEl(ln, "solidFill") || firstEl(ln, "gradFill") || firstEl(ln, "pattFill") || firstEl(ln, "noFill");
      if (lnFill) ln.removeChild(lnFill);
      ln.appendChild(createEl(doc, "a:noFill"));
    }
  }

  function imageSize(u8) {
    var w = 0;
    var h = 0;
    if (u8.length > 24 && u8[0] === 0xFF && u8[1] === 0xD8) {
      var i = 2;
      while (i + 9 < u8.length) {
        if (u8[i] !== 0xFF) {
          i++;
          continue;
        }
        var marker = u8[i + 1];
        if (marker === 0xFF) {
          i++;
          continue;
        }
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC && marker !== 0xD8 && marker !== 0xD9) {
          h = (u8[i + 5] << 8) | u8[i + 6];
          w = (u8[i + 7] << 8) | u8[i + 8];
          break;
        }
        var len = ((u8[i + 2] << 8) | u8[i + 3]) & 0xFFFF;
        if (len < 2) break;
        i += 2 + len;
      }
    } else if (u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
      w = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
      h = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    }
    return [w || 1, h || 1];
  }

  function buildPicElement(spTree, id, name, relId, mediaName, L, T, W, H, cropL, cropR, cropT, cropB) {
    var doc = spTree.ownerDocument;
    var src = null;
    var children = spTree.childNodes;
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 1 && local(children[i]) === "pic") {
        src = children[i];
        break;
      }
    }
    var pic;
    if (src) {
      pic = src.cloneNode(true);
    } else {
      pic = createEl(doc, "p:pic");
      var nv = createEl(doc, "p:nvPicPr");
      var cPr = createEl(doc, "p:cNvPr");
      cPr.setAttribute("id", String(id));
      cPr.setAttribute("name", name);
      cPr.setAttribute("descr", mediaName);
      nv.appendChild(cPr);
      var cPic = createEl(doc, "p:cNvPicPr");
      var locks = createEl(doc, "a:picLocks");
      locks.setAttribute("noChangeAspect", "1");
      cPic.appendChild(locks);
      nv.appendChild(cPic);
      nv.appendChild(createEl(doc, "p:nvPr"));
      pic.appendChild(nv);
      var fill = createEl(doc, "p:blipFill");
      var blip = createEl(doc, "a:blip");
      blip.setAttribute("r:embed", relId);
      fill.appendChild(blip);
      var stretch = createEl(doc, "a:stretch");
      stretch.appendChild(createEl(doc, "a:fillRect"));
      fill.appendChild(stretch);
      pic.appendChild(fill);
      var spPr = createEl(doc, "p:spPr");
      var xfrm = createEl(doc, "a:xfrm");
      xfrm.appendChild(createEl(doc, "a:off"));
      xfrm.appendChild(createEl(doc, "a:ext"));
      spPr.appendChild(xfrm);
      var geom = createEl(doc, "a:prstGeom");
      geom.setAttribute("prst", "rect");
      geom.appendChild(createEl(doc, "a:avLst"));
      spPr.appendChild(geom);
      pic.appendChild(spPr);
    }
    var cNvPr = firstEl(firstEl(pic, "nvPicPr"), "cNvPr");
    if (cNvPr) {
      cNvPr.setAttribute("id", String(id));
      cNvPr.setAttribute("name", name);
      cNvPr.setAttribute("descr", mediaName);
    }
    var fill2 = firstEl(pic, "blipFill");
    var blip2 = firstEl(fill2, "blip");
    if (blip2) blip2.setAttribute("r:embed", relId);
    var oldSrc = firstEl(fill2, "srcRect");
    if (oldSrc) fill2.removeChild(oldSrc);
    var stretch2 = firstEl(fill2, "stretch");
    if (cropL || cropR || cropT || cropB) {
      var sr = createEl(doc, "a:srcRect");
      if (cropL) sr.setAttribute("l", String(Math.round(cropL * 100000)));
      if (cropT) sr.setAttribute("t", String(Math.round(cropT * 100000)));
      if (cropR) sr.setAttribute("r", String(Math.round(cropR * 100000)));
      if (cropB) sr.setAttribute("b", String(Math.round(cropB * 100000)));
      fill2.insertBefore(sr, stretch2);
    }
    var spPr2 = firstEl(pic, "spPr");
    var xfrm2 = firstEl(spPr2, "xfrm");
    var off2 = firstEl(xfrm2, "off");
    var ext2 = firstEl(xfrm2, "ext");
    off2.setAttribute("x", String(L));
    off2.setAttribute("y", String(T));
    ext2.setAttribute("cx", String(W));
    ext2.setAttribute("cy", String(H));
    return pic;
  }

  function dataUrlToBytes(data) {
    var i = data.indexOf(",");
    var b64 = data.slice(i + 1).replace(/\s+/g, "");
    var bin = global.atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
    return u8;
  }

  function dataUrlExt(data) {
    var m = /^data:([^;,]+)/.exec(data);
    if (!m) return { ext: "jpg", ct: "image/jpeg" };
    var ct = m[1].toLowerCase();
    if (ct === "image/png") return { ext: "png", ct: "image/png" };
    return { ext: "jpg", ct: "image/jpeg" };
  }

  function nextMediaIndex(zip) {
    var mx = 0;
    var re = /^ppt\/media\/image(\d+)\./;
    for (var name in zip.files) {
      var f = zip.files[name];
      if (f && !f.dir) {
        var mm = re.exec(name);
        if (mm) {
          var v = parseInt(mm[1], 10);
          if (v > mx) mx = v;
        }
      }
    }
    return mx + 1;
  }

  async function nextRelId(zip, path) {
    var s = await zip.file(path).async("string");
    var mx = 0;
    var re = /Id="rId(\d+)"/g;
    var m;
    while ((m = re.exec(s))) {
      var v = parseInt(m[1], 10);
      if (v > mx) mx = v;
    }
    return mx + 1;
  }

  async function ensureContentType(zip, ext, contentType) {
    var path = "[Content_Types].xml";
    var s = await zip.file(path).async("string");
    if (s.indexOf('Extension="' + ext + '"') !== -1) return;
    var def = '<Default Extension="' + ext + '" ContentType="' + contentType + '"/>';
    var oi = s.indexOf("<Override");
    if (oi === -1) {
      s = s.replace("</Types>", def + "</Types>");
    } else {
      s = s.slice(0, oi) + def + s.slice(oi);
    }
    zip.file(path, s);
  }

  function parseXml(s) {
    return new global.DOMParser().parseFromString(s, "application/xml");
  }

  function serializeXml(doc) {
    var s = new global.XMLSerializer().serializeToString(doc);
    s = s.replace(/^\s*<\?xml[^?]*\?>\s*/, "");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
  }

  async function buildReferenzPptx(D, templateUrl) {
    templateUrl = templateUrl || "vorlage/LOS04_P13_Referenzblatt_Vorlage.pptx";
    D = D || {};
    var res = await global.fetch(templateUrl);
    var zip = await JSZip.loadAsync(await res.arrayBuffer());

    var doc1 = parseXml(await zip.file("ppt/slides/slide1.xml").async("string"));
    var doc2 = parseXml(await zip.file("ppt/slides/slide2.xml").async("string"));
    var spTree1 = doc1.getElementsByTagName("p:spTree")[0];
    var spTree2 = doc2.getElementsByTagName("p:spTree")[0];
    var a = shapesOf(spTree1);
    var b = shapesOf(spTree2);

    var H = D.h && typeof D.h === "object" ? D.h : {};
    var DEF_H = { projekt: 32, leistungen: 35, bezug: 40 };
    var nr = str(D.nr);
    var art = str(D.art);
    if (art === "__x") art = "";
    var kopf = "REFERENZ " + (nr || "[NR.]") + "  |  " + (art || "[VERANSTALTUNGSART]");
    var drop = [];

    setText(a[0], kopf, null);
    setText(b[0], kopf, null);
    setText(a[2], str(D.kunde), BLACK);
    setText(a[3], str(D.veranstaltung), BLACK);

    var tiles = Array.isArray(D.tiles) ? D.tiles : [];
    for (var i = 0; i < 8; i++) {
      var t = i < tiles.length && tiles[i] && typeof tiles[i] === "object" ? tiles[i] : {};
      if (str(t.l)) setText(a[8 + i * 3], str(t.l), null);
      setText(a[9 + i * 3], str(t.v), BLACK);
    }

    setText(a[33], str(D.projekt), BLACK);

    var ls = str(D.leistungen).split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return x; }).slice(0, 4);
    if (ls.length) {
      setLines(a[36], ls);
    } else {
      setText(a[36], "", BLACK);
    }

    for (var dk in DEF_H) {
      if (str(H[dk])) setText(a[DEF_H[dk]], str(H[dk]), null);
    }
    if (!str(H.bezug)) setText(a[40], "UNSERE STÄRKEN IN DIESEM PROJEKT", null);

    var bz = Array.isArray(D.bezug) ? D.bezug : [];
    for (i = 0; i < 4; i++) {
      var v = i < bz.length ? str(bz[i]) : "";
      setText(a[41 + i], v ? "✓  " + v : "", null);
    }

    const footer = typeof window !== "undefined" && window.footText ? window.footText(D) : str(D.footer);
    if (footer) {
      setText(a[46], footer, null);
      setText(b[60], footer, null);
    }

    var img = D.img && typeof D.img === "object" ? D.img : {};
    var q1 = str(D.bildquelle1);
    var q2 = str(D.bildquelle2);
    var mediaIdx = nextMediaIndex(zip);
    var rel1 = await nextRelId(zip, "ppt/slides/_rels/slide1.xml.rels");
    var nextId = maxShapeId(a) + 1;
    var slots = [
      [a[5], img.bild1, a[6], q1],
      [a[37], img.bild2, a[38], q2]
    ];
    for (var si = 0; si < slots.length; si++) {
      var slot = slots[si];
      var data = slot[1] && typeof slot[1] === "object" ? str(slot[1].data) : "";
      var inserted = false;
      if (data.indexOf("data:image/") === 0 && data.indexOf(",") >= 0) {
        var de = dataUrlExt(data);
        var mediaName = "image" + mediaIdx + "." + de.ext;
        var relId = "rId" + rel1;
        var u8 = dataUrlToBytes(data);
        var spPr = firstEl(slot[0], "spPr");
        var xfrm = firstEl(spPr, "xfrm");
        var off = firstEl(xfrm, "off");
        var ext = firstEl(xfrm, "ext");
        var bl = parseFloat(off.getAttribute("x")) || 0;
        var bt = parseFloat(off.getAttribute("y")) || 0;
        var bw = parseFloat(ext.getAttribute("cx")) || 0;
        var bh = parseFloat(ext.getAttribute("cy")) || 0;
        var sz = imageSize(u8);
        var iw = sz[0];
        var ih = sz[1];
        var modus = slot[1].modus || "fuellen";
        var dw;
        var dh;
        if (modus === "original") {
          var ow = Number(slot[1].ow) || iw;
          var oh = Number(slot[1].oh) || ih;
          dw = ow / 37.795 * 360000;
          dh = oh / 37.795 * 360000;
        } else {
          var sc = null;
          if (modus === "vertikal") sc = bh / ih;
          else if (modus === "horizontal") sc = bw / iw;
          if (sc === null) {
            dw = bw;
            dh = bh;
          } else {
            dw = iw * sc;
            dh = ih * sc;
          }
        }
        var dl = bl + (bw - dw) / 2;
        var dt = bt + (bh - dh) / 2;
        var vl = Math.max(dl, bl);
        var vt = Math.max(dt, bt);
        var vr = Math.min(dl + dw, bl + bw);
        var vb = Math.min(dt + dh, bt + bh);
        var cropL = (vl - dl) / dw;
        var cropR = (dl + dw - vr) / dw;
        var cropT = (vt - dt) / dh;
        var cropB = (dt + dh - vb) / dh;
        var pic = buildPicElement(spTree1, nextId, "Picture " + (nextId - 1), relId, mediaName, Math.trunc(vl), Math.trunc(vt), Math.trunc(vr - vl), Math.trunc(vb - vt), cropL, cropR, cropT, cropB);
        spTree1.appendChild(pic);
        slot[0].parentNode.removeChild(slot[0]);
        nextId++;
        mediaIdx++;
        rel1++;
        zip.file("ppt/media/" + mediaName, u8);
        zip.file("ppt/slides/_rels/slide1.xml.rels", (await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string")).replace("</Relationships>", '<Relationship Id="' + relId + '" Type="' + REL_IMAGE + '" Target="../media/' + mediaName + '"/>' + "</Relationships>"));
        await ensureContentType(zip, de.ext, de.ct);
        inserted = true;
      }
      if (!inserted) emptyPlaceholder(slot[0]);
      if (slot[3]) {
        setText(slot[2], slot[3], null);
      } else {
        drop.push(slot[2]);
      }
    }

    setText(b[2], str(H.details) || "Projektdetails", null);
    setText(b[3], [str(D.kunde), str(D.veranstaltung)].filter(function (x) { return x; }).join(" – "), null);

    var H2 = { ausgang: 6, technik: 9, ablauf: 12, herausf: 30, loesung: 33, partner: 36, ap: 50, ap1: 51, ap2: 53, ap3: 55, ap4: 57 };
    for (var hk in H2) {
      if (str(H[hk])) setText(b[H2[hk]], str(H[hk]), null);
    }

    setText(b[7], str(D.ausgang), BLACK);

    var tbl = firstDescendant(b[10], "tbl");
    if (tbl) {
      var trs = kids(tbl, "tr");
      if (trs.length) {
        var thKeys = ["th1", "th2", "th3"];
        for (var c = 0; c < 3; c++) {
          if (str(H[thKeys[c]])) {
            var thCells = kids(trs[0], "tc");
            if (c < thCells.length) setCell(thCells[c], str(H[thKeys[c]]), null);
          }
        }
      }
      var techRows = (Array.isArray(D.tech) ? D.tech : []).filter(function (t2) {
        return t2 && typeof t2 === "object" && (str(t2.k) || str(t2.u) || str(t2.e));
      }).slice(0, 5);
      for (var r = 0; r < 5; r++) {
        var t3 = r < techRows.length ? techRows[r] : {};
        if (r + 1 >= trs.length) break;
        var cells = kids(trs[r + 1], "tc");
        var ks = ["k", "u", "e"];
        for (c = 0; c < 3; c++) {
          if (c < cells.length) setCell(cells[c], str(t3[ks[c]]), BLACK);
        }
      }
    }

    var ph = Array.isArray(D.phasen) ? D.phasen : [];
    for (i = 0; i < 4; i++) {
      var p = i < ph.length && ph[i] && typeof ph[i] === "object" ? ph[i] : {};
      if (str(p.t)) setText(b[14 + i * 4], str(p.t), null);
      setText(b[15 + i * 4], str(p.z), BLACK);
      setText(b[16 + i * 4], str(p.x), BLACK);
    }

    setText(b[31], str(D.herausf), BLACK);
    setText(b[34], str(D.loesung), BLACK);

    var pa = Array.isArray(D.partner) ? D.partner : [];
    for (i = 0; i < 4; i++) {
      var pp = i < pa.length && pa[i] && typeof pa[i] === "object" ? pa[i] : {};
      if (str(pp.l)) setText(b[38 + i * 3], str(pp.l), null);
      setText(b[39 + i * 3], str(pp.f), BLACK);
    }

    var ap = D.ap && typeof D.ap === "object" ? D.ap : {};
    var apIdx = [["firma", 52], ["name", 54], ["funktion", 56], ["kontakt", 58]];
    for (i = 0; i < apIdx.length; i++) setText(b[apIdx[i][1]], str(ap[apIdx[i][0]]), BLACK);

    for (var dd = 0; dd < drop.length; dd++) {
      if (drop[dd].parentNode) drop[dd].parentNode.removeChild(drop[dd]);
    }

    zip.file("ppt/slides/slide1.xml", serializeXml(doc1));
    zip.file("ppt/slides/slide2.xml", serializeXml(doc2));

    return zip.generateAsync({ type: "blob", mimeType: MIME, compression: "DEFLATE" });
  }

  global.buildReferenzPptx = buildReferenzPptx;
})(typeof window !== "undefined" ? window : globalThis);
