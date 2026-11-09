/*!
 * k5-bootlogo-writer.js
 * <k5-bootlogo-writer> Web Component —— 泉盛 K5/K6 开机图片读写（Web Serial）
 *
 * 用法（任意框架 / 纯 HTML 均可用）：
 *   <script src="k5-bootlogo-writer.js"></script>
 *   <k5-bootlogo-writer></k5-bootlogo-writer>
 *
 * 协议说明：与官方 losehu/uv-k5-firmware-custom 写频脚本(picture.py)及固件 app/uart.c 逐字节一致。
 */
(function () {
  'use strict';

  /* ==================== 协议常量 ==================== */
  var XOR_ARRAY = hexToBytes('166c14e62e910d402135d5401303e980');
  var TS = [0x82, 0x40, 0x74, 0x65];      // 会话时间戳（hello 设定，后续读写必须一致）
  var BOOT_ADDR = 0x02080;                 // 开机画面 EEPROM 地址
  var W = 128, H = 64;

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
  // CRC-16/CCITT (poly 0x1021, init 0x0000) —— 与固件 CRC_Calculate1 / picture.py 查表一致
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
  // 帧: AB CD | len(LE) | XOR(payload + crc16(LE)) | DC BA
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

  // 0x0514 握手（设定会话时间戳）
  function buildHello() {
    return buildMessage(new Uint8Array([0x14, 0x05, 0x04, 0x00, TS[0], TS[1], TS[2], TS[3]]));
  }
  // 0x051B 读 128 字节（16 位地址）
  function buildReadChunk(addr) {
    var p = new Uint8Array(14);
    p[0] = 0x1B; p[1] = 0x05;                                   // Header.ID = 0x051B
    p[2] = 0x0A; p[3] = 0x00;                                   // Header.Size = 10
    p[4] = addr & 0xFF; p[5] = (addr >> 8) & 0xFF;              // Offset (16bit)
    p[6] = 128; p[7] = 0x00;                                    // Size / Padding
    p[8] = TS[0]; p[9] = TS[1]; p[10] = TS[2]; p[11] = TS[3];   // Timestamp
    p[12] = 0x00; p[13] = 0x00;                                 // ADD（0x051B 不用）
    return buildMessage(p);
  }
  // 0x0538 写 128 字节（Data[0..1] 为低 16 位地址，Data[2..] 为数据）
  function buildWriteChunk(addr, data128) {
    var p = new Uint8Array(14 + 128);
    p[0] = 0x38; p[1] = 0x05;                                   // Header.ID = 0x0538
    p[2] = 0x8A; p[3] = 0x00;                                   // Header.Size = 138
    p[4] = 0x00; p[5] = 0x00;                                   // Offset(高16位) = 0
    p[6] = 0x82; p[7] = 0x00;                                   // Size=130 / bAllowPassword=0
    p[8] = TS[0]; p[9] = TS[1]; p[10] = TS[2]; p[11] = TS[3];   // Timestamp
    p[12] = addr & 0xFF; p[13] = (addr >> 8) & 0xFF;            // 低16位地址
    p.set(data128, 14);
    return buildMessage(p);
  }

  function parseVersion(resp) {
    var decoded = payloadXor(resp.slice(4, -4));   // 去掉 AB CD + len(4) 与 crc+DC BA(4)
    var ver = decoded.slice(4, 24);                 // ID(2)+Size(2)+Version(16)+...
    var end = ver.indexOf(0);
    if (end < 0) end = ver.length;
    return new TextDecoder().decode(ver.slice(0, end)).trim();
  }
  function parseReadData(resp) {
    var decoded = payloadXor(resp.slice(4, -4));
    return decoded.slice(8, 8 + 128);               // ID(2)+Size(2)+Offset(2)+Size(1)+Pad(1)+Data
  }

  /* ==================== 图片处理 ==================== */
  function toGray(img, stretch, text, fontSize, textY) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (img) {
      if (stretch) {
        ctx.drawImage(img, 0, 0, W, H);
      } else {
        var s = Math.min(W / img.width, H / img.height);
        var dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    }
    if (text) {
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var fs = fontSize || 18;
      ctx.font = 'bold ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
      var lines = text.split('\n');
      var lh = fs + 2;
      var startY = (textY == null ? H / 2 : textY) - (lines.length - 1) * lh / 2;
      for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, startY + i * lh);
    }
    var data = ctx.getImageData(0, 0, W, H).data;
    var gray = new Float32Array(W * H);
    for (var i = 0; i < W * H; i++) {
      var j = i * 4;
      gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
    return gray;
  }
  function otsu(gray) {
    var hist = new Float64Array(256);
    for (var i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
    var sum = 0, total = gray.length;
    for (var i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, max = 0, thr = 0;
    for (var i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      var between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) * ((sumB / wB) - ((sum - sumB) / wF));
      if (between > max) { max = between; thr = i; }
    }
    return thr;
  }
  // Floyd–Steinberg 误差扩散抖动
  function floydSteinberg(gray, thr, invert) {
    var buf = Float32Array.from(gray);
    var out = new Uint8Array(1024);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        var oldVal = buf[idx];
        var isBlack = oldVal < thr;
        var q = isBlack ? (invert ? 255 : 0) : (invert ? 0 : 255);
        if (q === 0) out[(y >> 3) * W + x] |= (1 << (y & 7));
        var err = oldVal - q;
        if (x + 1 < W) buf[idx + 1] += err * 7 / 16;
        if (y + 1 < H) {
          if (x - 1 >= 0) buf[idx + W - 1] += err * 3 / 16;
          buf[idx + W] += err * 5 / 16;
          if (x + 1 < W) buf[idx + W + 1] += err * 1 / 16;
        }
      }
    }
    return out;
  }
  // 无抖动阈值（作为对比/兜底）
  function simpleThreshold(gray, thr, invert) {
    var out = new Uint8Array(1024);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var q = (gray[y * W + x] < thr) ? (invert ? 255 : 0) : (invert ? 0 : 255);
        if (q === 0) out[(y >> 3) * W + x] |= (1 << (y & 7));
      }
    }
    return out;
  }
  // 1024 字节位图 -> 灰度数组（用于预览读回的画面）
  function bitmapToGray(buf) {
    var gray = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var bit = (buf[(y >> 3) * W + x] >> (y & 7)) & 1;
        gray[y * W + x] = bit ? 0 : 255;
      }
    }
    return gray;
  }

  /* ==================== Web Component ==================== */
  var CSS = '\
    :host { display: block; font-family: system-ui, "Microsoft YaHei", sans-serif; max-width: 720px; line-height: 1.6; color: #222; }\
    .warn { background: #fff8e1; border: 1px solid #e0c060; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin: 12px 0; }\
    .card { border: 1px solid #8884; border-radius: 10px; padding: 14px; margin: 12px 0; }\
    .card b { display: block; margin-bottom: 6px; }\
    button { padding: 8px 14px; font-size: 14px; border-radius: 8px; border: none; background: #2f81f7; color: #fff; cursor: pointer; margin-right: 8px; }\
    button:disabled { background: #aaa; cursor: not-allowed; }\
    button.ghost { background: #555; }\
    canvas { width: 384px; height: 192px; image-rendering: pixelated; border: 1px solid #888; background: #fff; display: block; margin: 8px 0; }\
    label { margin-right: 14px; font-size: 13px; }\
    .muted { color: #888; font-size: 12px; }\
    #status { font-size: 13px; margin-left: 6px; }\
    #log { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #0001; border-radius: 8px; padding: 8px; min-height: 40px; margin-top: 8px; }';

  var TEMPLATE = '\
    <div class="warn"><b>使用前提：</b>① 对讲机已刷 <b>LOSEHU xxxK / xxxH / xxxHS</b> 固件（需已扩容 EEPROM ≥1MiB）；② 用泉盛写频线连接电脑并<b>开机</b>；③ 用 <b>Chrome/Edge</b> 且页面需 <b>HTTPS</b> 或 localhost。</div>\
    <div class="card"><b>① 连接对讲机</b>\
      <button id="connectBtn">连接对讲机</button><span id="status"></span>\
    </div>\
    <div class="card"><b>② 选择图片 / 输入文字</b>\
      <input type="file" id="fileInput" accept="image/*">\
      <div style="margin-top:8px">\
        <label><input type="checkbox" id="invert"> 反色</label>\
        <label><input type="checkbox" id="stretch"> 拉伸填满</label>\
        <label><input type="checkbox" id="dither" checked> Floyd–Steinberg 抖动</label>\
      </div>\
      <div style="margin-top:8px">\
        <label>文字(呼号/名字，可留空)：<input type="text" id="textInput" style="width:150px" placeholder="BG1ABC"></label>\
        <label>字号：<input type="number" id="fontSize" value="18" min="8" max="40" style="width:52px"></label>\
        <label>纵向位置(0-64)：<input type="number" id="textY" value="32" min="0" max="64" style="width:52px"></label>\
      </div>\
      <canvas id="preview" width="128" height="64"></canvas>\
      <span class="muted">预览即最终写入对讲机的效果（黑白 128×64）；文字会叠加到图片上，也可只填文字不选图片</span>\
    </div>\
    <div class="card"><b>③ 操作</b>\
      <button id="readBtn" disabled>读回当前开机画面</button>\
      <button id="writeBtn" disabled>写入开机图片</button>\
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

  var K5BootlogoWriter = /** @class */ (function () {
    function K5BootlogoWriter() {
      this.port = null;
      this.bitmap = null;   // 1024 字节位图
      this.img = null;      // 原始 ImageBitmap
    }
    K5BootlogoWriter.prototype.connectedCallback = function () {
      var root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + CSS + '</style>' + TEMPLATE;
      this.$ = function (id) { return root.getElementById(id); };
      this.log = function (m) { this.$('log').textContent += '\n' + m; };
      this.setStatus = function (s) { this.$('status').textContent = s; };
      this.bind();
    };

    K5BootlogoWriter.prototype.bind = function () {
      var self = this;
      this.$('connectBtn').addEventListener('click', function () { self.connect(); });
      this.$('fileInput').addEventListener('change', function (e) { self.onFile(e); });
      this.$('invert').addEventListener('change', function () { self.reapply(); });
      this.$('stretch').addEventListener('change', function () { self.reapply(); });
      this.$('dither').addEventListener('change', function () { self.reapply(); });
      this.$('textInput').addEventListener('input', function () { self.reapply(); });
      this.$('fontSize').addEventListener('input', function () { self.reapply(); });
      this.$('textY').addEventListener('input', function () { self.reapply(); });
      this.$('readBtn').addEventListener('click', function () { self.readBack(); });
      this.$('writeBtn').addEventListener('click', function () { self.write(); });
    };

    K5BootlogoWriter.prototype.connect = function () {
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
          if (!(ver.indexOf('LOSEHU') === 0 && (ver.slice(-1) === 'K' || ver.slice(-1) === 'H'))) {
            throw new Error('该固件 ' + ver + ' 不支持开机图片（需 LOSEHU xxxK/xxxH/xxxHS）');
          }
          self.setStatus('已识别: ' + ver + '，支持开机图片');
          self.$('readBtn').disabled = false;
          self.$('writeBtn').disabled = !self.bitmap;
        });
      })().catch(function (e) {
        self.setStatus('失败: ' + e.message);
        self.log('错误: ' + e.message);
        if (self.port) { try { self.port.close(); } catch (_) {} }
        self.port = null;
        self.$('readBtn').disabled = true;
        self.$('writeBtn').disabled = true;
      });
    };

    K5BootlogoWriter.prototype.onFile = function (e) {
      var self = this;
      var file = e.target.files[0];
      if (!file) return;
      createImageBitmap(file).then(function (img) {
        self.img = img;
        self.reapply();
        self.log('已载入图片: ' + file.name);
      }).catch(function (err) { self.log('图片读取失败: ' + err.message); });
    };

    K5BootlogoWriter.prototype.reapply = function () {
      var invert = this.$('invert').checked;
      var stretch = this.$('stretch').checked;
      var dither = this.$('dither').checked;
      var text = this.$('textInput').value.trim();
      var fontSize = parseInt(this.$('fontSize').value, 10) || 18;
      var textY = parseInt(this.$('textY').value, 10);
      if (isNaN(textY)) textY = 32;
      if (!this.img && !text) return;
      var gray = toGray(this.img, stretch, text, fontSize, textY);
      var thr = otsu(gray);
      this.bitmap = dither ? floydSteinberg(gray, thr, invert) : simpleThreshold(gray, thr, invert);
      this.drawPreview(this.bitmap);
      if (this.port) this.$('writeBtn').disabled = false;
    };

    K5BootlogoWriter.prototype.drawPreview = function (buf) {
      var cv = this.$('preview');
      var ctx = cv.getContext('2d');
      var gray = bitmapToGray(buf);
      var id = ctx.createImageData(W, H);
      for (var i = 0; i < gray.length; i++) {
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = gray[i];
        id.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
    };

    K5BootlogoWriter.prototype.readBack = function () {
      var self = this;
      this.$('readBtn').disabled = true;
      var buf = new Uint8Array(1024);
      var chain = send(self.port, buildHello(), 1200).then(function (resp) {
        if (resp.length === 0) throw new Error('无响应');
        return resp;
      });
      for (var i = 0; i < 8; i++) {
        (function (i) {
          chain = chain.then(function () {
            return send(self.port, buildReadChunk(BOOT_ADDR + i * 128), 700).then(function (resp) {
              if (resp.length === 0) throw new Error('第 ' + (i + 1) + '/8 块读取无响应');
              var data = parseReadData(resp);
              buf.set(data, i * 128);
              self.log('读取块 ' + (i + 1) + '/8 完成');
            });
          });
        })(i);
      }
      chain.then(function () {
        self.bitmap = buf;
        self.drawPreview(buf);
        self.log('✓ 已读回当前开机画面（预览如上）');
        if (self.port) self.$('writeBtn').disabled = false;
      }).catch(function (e) {
        self.log('读取失败: ' + e.message);
      }).then(function () {
        self.$('readBtn').disabled = false;
      });
    };

    K5BootlogoWriter.prototype.write = function () {
      var self = this;
      if (!this.port || !this.bitmap) return;
      this.$('writeBtn').disabled = true;
      var chain = send(self.port, buildHello(), 1200).then(function (resp) {
        if (resp.length === 0) throw new Error('无响应');
      });
      for (var i = 0; i < 8; i++) {
        (function (i) {
          chain = chain.then(function () {
            var chunk = self.bitmap.slice(i * 128, i * 128 + 128);
            return send(self.port, buildWriteChunk(BOOT_ADDR + i * 128, chunk), 1200).then(function (resp) {
              if (resp.length === 0) throw new Error('第 ' + (i + 1) + '/8 块写入无响应');
              self.log('写入块 ' + (i + 1) + '/8 完成 (0x' + (BOOT_ADDR + i * 128).toString(16) + ')');
            });
          });
        })(i);
      }
      chain.then(function () {
        self.log('✓ 写入成功！重启对讲机即可看到新开机图片。');
        self.setStatus('写入成功');
      }).catch(function (e) {
        self.log('写入失败: ' + e.message);
        self.setStatus('失败: ' + e.message);
      }).then(function () {
        self.$('writeBtn').disabled = false;
      });
    };

    return K5BootlogoWriter;
  })();

  customElements.define('k5-bootlogo-writer', K5BootlogoWriter);
})();
