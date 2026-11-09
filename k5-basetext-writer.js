/*!
 * k5-basetext-writer.js
 * <k5-basetext-writer> Web Component —— 泉盛 K5/K6 基础版固件「开机文字」写入（Web Serial）
 *
 * 用法：
 *   <script src="k5-basetext-writer.js"></script>
 *   <k5-basetext-writer></k5-basetext-writer>
 *
 * 说明：
 *  - 目标地址：EEPROM 0x0EB0（第 1 行，16 字节）/ 0x0EC0（第 2 行，16 字节）
 *  - 写入命令：0x051D（CMD_051D，按 8 字节块写）
 *  - 适用于 LOSEHU 基础版固件（LOSEHU133.bin / LOSEHU133E.bin）；K/H 版欢迎文字在别的地址。
 *  - 仅支持 ASCII（英文/数字/常用符号）；中文为固件内部单字节字形表，非标准 GB2312，故未支持。
 */
(function () {
  'use strict';

  var XOR_ARRAY = hexToBytes('166c14e62e910d402135d5401303e980');
  var TS = [0x82, 0x40, 0x74, 0x65];
  var ADDR_LINE1 = 0x0EB0;
  var ADDR_LINE2 = 0x0EC0;
  var LINE_LEN = 16;

  function hexToBytes(hex) {
    var out = [];
    for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
  }
  function payloadXor(payload) {
    var out = new Uint8Array(payload.length);
    for (var i = 0; i < payload.length; i++) out[i] = payload[i] ^ XOR_ARRAY[i % XOR_ARRAY.length];
    return out;
  }
  function crc16Ccitt(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] << 8);
      for (var b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
      }
    }
    return crc & 0xFFFF;
  }
  function buildMessage(payload) {
    var crc = crc16Ccitt(payload);
    var full = new Uint8Array(payload.length + 2);
    full.set(payload, 0);
    full[payload.length] = crc & 0xFF;
    full[payload.length + 1] = (crc >> 8) & 0xFF;
    var xored = payloadXor(full);
    var msg = new Uint8Array(xored.length + 6);
    msg[0] = 0xAB; msg[1] = 0xCD;
    msg[2] = payload.length & 0xFF; msg[3] = (payload.length >> 8) & 0xFF;
    msg.set(xored, 4);
    msg[msg.length - 2] = 0xDC; msg[msg.length - 1] = 0xBA;
    return msg;
  }

  function buildHello() {
    return buildMessage(new Uint8Array([0x14, 0x05, 0x04, 0x00, TS[0], TS[1], TS[2], TS[3]]));
  }
  // 0x051B 读 16 字节
  function buildRead16(addr) {
    var p = new Uint8Array(14);
    p[0] = 0x1B; p[1] = 0x05;
    p[2] = 0x0A; p[3] = 0x00;                                   // Header.Size = 10
    p[4] = addr & 0xFF; p[5] = (addr >> 8) & 0xFF;
    p[6] = LINE_LEN; p[7] = 0x00;
    p[8] = TS[0]; p[9] = TS[1]; p[10] = TS[2]; p[11] = TS[3];
    p[12] = 0x00; p[13] = 0x00;
    return buildMessage(p);
  }
  // 0x051D 写 16 字节（Header(4)+Offset(2)+Size(1)+bAllow(1)+Timestamp(4)+Data(16) = 28）
  function buildWrite16(addr, data16) {
    var p = new Uint8Array(28);
    p[0] = 0x1D; p[1] = 0x05;                                   // Header.ID = 0x051D
    p[2] = 24; p[3] = 0x00;                                     // Header.Size = 24
    p[4] = addr & 0xFF; p[5] = (addr >> 8) & 0xFF;              // Offset
    p[6] = LINE_LEN; p[7] = 0x00;                               // Size=16 / bAllowPassword=0
    p[8] = TS[0]; p[9] = TS[1]; p[10] = TS[2]; p[11] = TS[3];   // Timestamp
    p.set(data16, 12);                                          // Data
    return buildMessage(p);
  }

  function parseVersion(resp) {
    var decoded = payloadXor(resp.slice(4, -4));
    var ver = decoded.slice(4, 24);
    var end = ver.indexOf(0);
    if (end < 0) end = ver.length;
    return new TextDecoder().decode(ver.slice(0, end)).trim();
  }
  function parseData(resp, size) {
    var decoded = payloadXor(resp.slice(4, -4));
    return decoded.slice(8, 8 + size);
  }
  function encodeAscii(str) {
    var out = new Uint8Array(LINE_LEN);
    var n = Math.min(str.length, LINE_LEN);
    for (var i = 0; i < n; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x20 || c > 0x7E) c = 0x3F; // 非 ASCII 用 '?'
      out[i] = c;
    }
    return out;
  }
  function decodeAscii(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  var CSS = '\
    :host { display: block; font-family: system-ui, "Microsoft YaHei", sans-serif; max-width: 720px; line-height: 1.6; color: #222; }\
    .warn { background: #fff8e1; border: 1px solid #e0c060; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin: 12px 0; }\
    .card { border: 1px solid #8884; border-radius: 10px; padding: 14px; margin: 12px 0; }\
    .card b { display: block; margin-bottom: 6px; }\
    button { padding: 8px 14px; font-size: 14px; border-radius: 8px; border: none; background: #2f81f7; color: #fff; cursor: pointer; margin-right: 8px; }\
    button:disabled { background: #aaa; cursor: not-allowed; }\
    input[type=text] { padding: 5px 8px; font-size: 14px; width: 180px; border: 1px solid #888; border-radius: 6px; }\
    label { display: block; margin: 6px 0; font-size: 14px; }\
    .muted { color: #888; font-size: 12px; }\
    #status { font-size: 13px; margin-left: 6px; }\
    #log { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #0001; border-radius: 8px; padding: 8px; min-height: 40px; margin-top: 8px; }';

  var TEMPLATE = '\
    <div class="warn"><b>使用前提：</b>对讲机已刷 <b>LOSEHU 基础版固件（LOSEHU133.bin / LOSEHU133E.bin，无需扩容）</b>；用写频线连接并<b>开机</b>；浏览器用 <b>Chrome/Edge</b>，页面走 <b>HTTPS</b>。<br>本工具写的是基础版固件的两行「开机文字」（EEPROM 0x0EB0 / 0x0EC0），仅支持<b>英文/数字/常用符号</b>（中文为固件内部单字节字形，暂不支持）。</div>\
    <div class="card"><b>① 连接对讲机</b>\
      <button id="connectBtn">连接对讲机</button><span id="status"></span>\
    </div>\
    <div class="card"><b>② 开机文字（每行最多 16 个字符）</b>\
      <label>第 1 行：<input type="text" id="line1" maxlength="16" placeholder="例如 QUANSHENG"></label>\
      <label>第 2 行：<input type="text" id="line2" maxlength="16" placeholder="例如 BG1ABC"></label>\
    </div>\
    <div class="card"><b>③ 操作</b>\
      <button id="readBtn" disabled>读取当前文字</button>\
      <button id="writeBtn" disabled>写入文字</button>\
    </div>\
    <div class="card"><b>日志</b><div id="log">就绪。</div></div>';

  function readResponse(port, timeoutMs) {
    var reader = port.readable.getReader();
    var chunks = [];
    var deadline = Date.now() + timeoutMs;
    return (function loop() {
      if (Date.now() >= deadline) { reader.releaseLock(); return Promise.resolve(concat(chunks)); }
      var remaining = deadline - Date.now();
      return Promise.race([
        reader.read(),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('t')); }, remaining); })
      ]).then(function (r) {
        if (r.done) { reader.releaseLock(); return concat(chunks); }
        if (r.value && r.value.length) chunks.push(r.value);
        return loop();
      }).catch(function () {
        reader.releaseLock();
        return concat(chunks);
      });
    })();
  }
  function concat(chunks) {
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var off = 0;
    for (var j = 0; j < chunks.length; j++) { out.set(chunks[j], off); off += chunks[j].length; }
    return out;
  }
  function send(port, bytes, timeoutMs) {
    var writer = port.writable.getWriter();
    var p = writer.write(bytes).then(function () { writer.releaseLock(); });
    return p.then(function () { return readResponse(port, timeoutMs); });
  }

  class K5BaseTextWriter extends HTMLElement {
    constructor() {
      super();
      this.port = null;
    }

    connectedCallback() {
      var root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + CSS + '</style>' + TEMPLATE;
      this.$ = function (id) { return root.getElementById(id); };
      this.log = function (m) { this.$('log').textContent += '\n' + m; };
      this.setStatus = function (s) { this.$('status').textContent = s; };
      this.bind();
    }

    bind() {
      var self = this;
      this.$('connectBtn').addEventListener('click', function () { self.connect(); });
      this.$('readBtn').addEventListener('click', function () { self.readText(); });
      this.$('writeBtn').addEventListener('click', function () { self.writeText(); });
    }

    connect() {
      var self = this;
      (function () {
        if (!('serial' in navigator)) throw new Error('当前浏览器不支持 Web Serial（请用 Chrome/Edge 且 HTTPS）');
        return navigator.serial.requestPort().then(function (p) {
          self.port = p;
          return p.open({ baudRate: 38400 });
        }).then(function () {
          self.setStatus('已连接，正在识别固件…');
          return send(self.port, buildHello(), 1200);
        }).then(function (resp) {
          if (resp.length === 0) throw new Error('对讲机无响应（确认已开机、写频线已接好）');
          var ver = parseVersion(resp);
          self.log('固件版本: ' + ver);
          if (ver.indexOf('LOSEHU') !== 0) {
            throw new Error('该固件 ' + ver + ' 不是 LOSEHU 固件，无法写入开机文字');
          }
          self.setStatus('已识别: ' + ver);
          self.$('readBtn').disabled = false;
          self.$('writeBtn').disabled = false;
        });
      })().catch(function (e) {
        self.setStatus('失败: ' + e.message);
        self.log('错误: ' + e.message);
        if (self.port) { try { self.port.close(); } catch (_) {} }
        self.port = null;
        self.$('readBtn').disabled = true;
        self.$('writeBtn').disabled = true;
      });
    }

    readText() {
      var self = this;
      this.$('readBtn').disabled = true;
      send(self.port, buildHello(), 1200).then(function (resp) {
        if (resp.length === 0) throw new Error('无响应');
        return send(self.port, buildRead16(ADDR_LINE1), 700);
      }).then(function (resp) {
        if (resp.length === 0) throw new Error('读取第 1 行无响应');
        var d = parseData(resp, LINE_LEN);
        self.$('line1').value = decodeAscii(d);
        self.log('第 1 行: ' + JSON.stringify(decodeAscii(d)));
        return send(self.port, buildRead16(ADDR_LINE2), 700);
      }).then(function (resp) {
        if (resp.length === 0) throw new Error('读取第 2 行无响应');
        var d = parseData(resp, LINE_LEN);
        self.$('line2').value = decodeAscii(d);
        self.log('第 2 行: ' + JSON.stringify(decodeAscii(d)));
        self.log('✓ 读取完成');
      }).catch(function (e) {
        self.log('读取失败: ' + e.message);
      }).then(function () {
        self.$('readBtn').disabled = false;
      });
    }

    writeText() {
      var self = this;
      var l1 = encodeAscii(this.$('line1').value);
      var l2 = encodeAscii(this.$('line2').value);
      this.$('writeBtn').disabled = true;
      send(self.port, buildHello(), 1200).then(function (resp) {
        if (resp.length === 0) throw new Error('无响应');
        return send(self.port, buildWrite16(ADDR_LINE1, l1), 1200);
      }).then(function (resp) {
        if (resp.length === 0) throw new Error('写第 1 行无响应');
        self.log('第 1 行写入完成 (0x' + ADDR_LINE1.toString(16) + ')');
        return send(self.port, buildWrite16(ADDR_LINE2, l2), 1200);
      }).then(function (resp) {
        if (resp.length === 0) throw new Error('写第 2 行无响应');
        self.log('第 2 行写入完成 (0x' + ADDR_LINE2.toString(16) + ')');
        self.log('✓ 写入成功！重启对讲机查看开机文字。');
        self.setStatus('写入成功');
      }).catch(function (e) {
        self.log('写入失败: ' + e.message);
        self.setStatus('失败: ' + e.message);
      }).then(function () {
        self.$('writeBtn').disabled = false;
      });
    }
  }

  customElements.define('k5-basetext-writer', K5BaseTextWriter);
})();
