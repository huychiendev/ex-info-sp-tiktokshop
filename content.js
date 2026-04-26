// Content script - Trích xuất thông tin sản phẩm TikTok Shop và gửi qua Telegram

(() => {
  'use strict';

  const PANEL_ID = 'tts-ext-panel';
  const PDP_PATH = '/pdp/';

  // --- Utilities ---

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
  }

  // --- Trích xuất thông tin sản phẩm ---

  function extractProductInfo() {
    const info = {
      title: '',
      rating: '',
      reviewCount: '',
      soldCount: '',
      price: '',
      description: '',
      variants: [],
      images: [],
      url: location.href
    };

    // 1. Tên sản phẩm
    const ogTitle = document.querySelector('meta[property="og:title"]');
    info.title = ogTitle
      ? ogTitle.content.trim()
      : document.title.replace(/\s*-\s*TikTok Shop.*$/, '').trim();

    // 2. Giá - tìm phần tử chỉ chứa ₫ + số, loại trừ phí vận chuyển
    for (const el of document.querySelectorAll('span, div')) {
      if (el.children.length > 1) continue;
      const text = el.textContent.trim();
      if (/^[₫đ]\s*[\d.,]+$/.test(text) || /^[\d.,]+\s*[₫đ]$/.test(text)) {
        let parent = el.parentElement;
        let isShipping = false;
        for (let i = 0; i < 3 && parent; i++) {
          if (parent.textContent.includes('vận chuyển')) { isShipping = true; break; }
          parent = parent.parentElement;
        }
        if (!isShipping) { info.price = text; break; }
      }
    }

    // 3. Rating - qua aria-label
    const starEl = document.querySelector('[aria-label*="Rating:"][aria-label*="out of 5"]');
    if (starEl) {
      const match = starEl.getAttribute('aria-label').match(/([\d.]+)\s*out of/);
      if (match) info.rating = match[1];

      const ratingRow = starEl.closest('.flex') || starEl.parentElement?.parentElement;
      if (ratingRow) {
        for (const span of ratingRow.querySelectorAll('span')) {
          const t = span.textContent.trim();
          if (!info.reviewCount && /^\(?\d+\)?$/.test(t)) {
            info.reviewCount = t.replace(/[()]/g, '');
          }
          if (!info.soldCount && (t.includes('đã được bán') || t.includes('đã bán'))) {
            info.soldCount = t;
          }
        }
      }
    }

    // 4. Biến thể
    document.querySelectorAll('.flex.flex-col.gap-20 > div').forEach(group => {
      const labelEl = group.querySelector('span[class*="H2-Semibold"][class*="text-color-UIText1Display"]');
      if (!labelEl) return;
      const variantName = labelEl.textContent.replace(/[:\s]+$/, '').trim();
      if (variantName.length > 30) return;

      const options = [];
      group.querySelectorAll('span[class*="P3-Regular"][class*="text-color-UIText1Display"]').forEach(opt => {
        const val = opt.textContent.trim();
        if (val) options.push(val);
      });
      if (options.length) info.variants.push({ name: variantName, options });
    });

    // 5. Ảnh sản phẩm
    const seenHashes = new Set();
    
    // Ưu tiên: Lấy ảnh từ phần Phân loại (Variations) nếu có để gán kèm tên
    document.querySelectorAll('.flex.flex-col > img').forEach(img => {
      const container = img.parentElement;
      if (!img.src || !container.classList.contains('cursor-pointer') && !container.classList.contains('border-dashed')) return;
      
      const hashMatch = img.src.match(/\/([a-f0-9]{20,})~/);
      const hash = hashMatch ? hashMatch[1] : img.src;
      if (seenHashes.has(hash)) return;
      
      // Chuyển URL ảnh thumbnail thành ảnh chất lượng cao (bỏ các thông số crop/resize nếu cần, hoặc mặc định nó đã to)
      const nameEl = container.querySelector('span');
      const name = nameEl ? nameEl.textContent.trim() : (img.alt || img.title || '');
      
      seenHashes.add(hash);
      info.images.push({ url: img.src, caption: name });
    });

    // Nếu không có ảnh phân loại, fallback về lấy ảnh ở slider bên trái
    if (info.images.length === 0) {
      document.querySelectorAll('.slick-slide:not(.slick-cloned)').forEach(slide => {
        if (slide.querySelector('video')) return;
        const img = slide.querySelector('img');
        if (!img || !img.src) return;

        const hashMatch = img.src.match(/\/([a-f0-9]{20,})~/);
        const hash = hashMatch ? hashMatch[1] : img.src;
        if (seenHashes.has(hash)) return;
        seenHashes.add(hash);
        info.images.push({ url: img.src, caption: '' });
      });
    }

    // 6. Mô tả sản phẩm
    for (const span of document.querySelectorAll('span')) {
      if (span.textContent.trim() === 'Mô tả sản phẩm' && span.children.length === 0) {
        const section = span.closest('div')?.parentElement;
        if (!section) continue;
        const descText = (section.innerText || '')
          .replace(/^Mô tả sản phẩm\s*/, '')
          .replace(/Xem thêm\s*$/, '')
          .trim();
        if (descText.length > 20) {
          info.description = descText;
          break;
        }
      }
    }

    return info;
  }

  // --- Format message ---

  function formatMessage(info, forHtml = false) {
    const esc = forHtml ? escapeHtml : (s) => s;
    const bold = (s) => forHtml ? `<b>${esc(s)}</b>` : s;

    let msg = bold(info.title) + '\n\n';
    if (info.price) msg += `Giá: ${bold(info.price)}\n`;
    if (info.rating) msg += `Đánh giá: ${esc(info.rating)}/5`;
    if (info.reviewCount) msg += ` (${esc(info.reviewCount)} đánh giá)`;
    if (info.rating || info.reviewCount) msg += '\n';
    if (info.soldCount) msg += `Đã bán: ${esc(info.soldCount)}\n`;

    if (info.variants.length) {
      msg += `\n${bold('Phân loại:')}\n`;
      info.variants.forEach(v => {
        msg += `  ${esc(v.name)}: ${v.options.map(esc).join(' | ')}\n`;
      });
    }

    if (info.description) {
      msg += `\n${bold('Mô tả:')}\n${esc(info.description)}\n`;
    }

    msg += `\nLink: ${info.url}`;
    return msg;
  }

  // --- Gửi qua Telegram ---

  async function sendToTelegram(info) {
    if (!chrome?.storage?.local) {
      throw new Error('Extension bị mất kết nối. Vui lòng tải lại trang (F5).');
    }
    const cfg = await new Promise(resolve =>
      chrome.storage.local.get(['botToken', 'chatId'], resolve)
    );

    if (!cfg.botToken || !cfg.chatId) {
      throw new Error('Chưa cấu hình Telegram. Mở popup extension để nhập Bot Token và Chat ID.');
    }

    const { botToken, chatId } = cfg;
    const apiBase = `https://api.telegram.org/bot${botToken}`;
    const fullText = formatMessage(info, true);

    if (!info.images.length) {
      await telegramFetch(`${apiBase}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      return;
    }

    // Hàm map tạo media cho Telegram
    const buildMedia = (item, ctxCaption, isFirst) => {
      const url = typeof item === 'object' ? item.url : item;
      const cap = typeof item === 'object' ? item.caption : '';
      
      let finalCaption = '';
      if (isFirst) {
        finalCaption = (cap ? `<b>${escapeHtml(cap)}</b>\n\n` : '') + ctxCaption;
      } else if (cap) {
        finalCaption = `<b>${escapeHtml(cap)}</b>`;
      }

      const res = { type: 'photo', media: url };
      if (finalCaption) {
        res.caption = finalCaption;
        res.parse_mode = 'HTML';
      }
      return res;
    };

    // Thử gửi ảnh + caption đầy đủ trong 1 message
    const chunks = chunkArray(info.images, 10);
    const firstMedia = chunks[0].map((item, i) => buildMedia(item, fullText, i === 0));

    try {
      await telegramFetch(`${apiBase}/sendMediaGroup`, {
        chat_id: chatId,
        media: JSON.stringify(firstMedia)
      });
    } catch {
      // Fallback: text trước, ảnh reply sau
      const textResult = await telegramFetch(`${apiBase}/sendMessage`, {
        chat_id: chatId,
        text: fullText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      const replyId = textResult.result?.message_id;
      // Gửi media nhưng VẪN giữ caption tên phân loại cho từng ảnh, chỉ bỏ đoạn text mô tả dài đi (đã gửi tren sendMessage)
      const mediaNoCaption = chunks[0].map((item, i) => buildMedia(item, '', false));
      const payload = { chat_id: chatId, media: JSON.stringify(mediaNoCaption) };
      if (replyId) payload.reply_to_message_id = replyId;
      await telegramFetch(`${apiBase}/sendMediaGroup`, payload);
    }

    // Nhóm ảnh còn lại (> 10 ảnh)
    for (let ci = 1; ci < chunks.length; ci++) {
      const mediaList = chunks[ci].map(item => buildMedia(item, '', false));
      await telegramFetch(`${apiBase}/sendMediaGroup`, {
        chat_id: chatId,
        media: JSON.stringify(mediaList)
      });
    }
  }

  async function telegramFetch(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram API: ${json.description}`);
    return json;
  }

  // --- Copy ---

  async function copyInfo(info) {
    await navigator.clipboard.writeText(formatMessage(info, false));
  }

  // --- Inject UI ---

  function injectPanel() {
    if (!location.pathname.includes(PDP_PATH)) return;
    if (document.getElementById(PANEL_ID)) return;

    const buyBtn = findBuyButton();
    if (!buyBtn) return;

    let anchor = buyBtn.parentElement;
    while (anchor && anchor.parentElement && anchor.parentElement.tagName !== 'BODY') {
      if (anchor.parentElement.children.length > 1) break;
      anchor = anchor.parentElement;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'tts-ext-panel';
    panel.innerHTML = `
      <button class="tts-ext-btn tts-ext-btn--send" id="tts-send-btn">Gửi Telegram</button>
      <button class="tts-ext-btn tts-ext-btn--copy" id="tts-copy-btn">Copy thông tin</button>
      <div class="tts-ext-panel__status" id="tts-status"></div>
    `;

    anchor.parentElement.insertBefore(panel, anchor.nextSibling);
    document.getElementById('tts-send-btn').addEventListener('click', handleSend);
    document.getElementById('tts-copy-btn').addEventListener('click', handleCopy);
  }

  function findBuyButton() {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim().includes('Mua ngay')) return btn;
    }
    return null;
  }

  function setStatus(text) {
    const el = document.getElementById('tts-status');
    if (el) el.textContent = text;
  }

  async function handleSend() {
    const btn = document.getElementById('tts-send-btn');
    btn.disabled = true;
    setStatus('Đang trích xuất...');

    try {
      const info = extractProductInfo();
      if (!info.title) throw new Error('Không tìm thấy thông tin sản phẩm');

      setStatus('Đang gửi Telegram...');
      await sendToTelegram(info);
      setStatus(`Đã gửi! (${info.images.length} ảnh)`);
    } catch (err) {
      setStatus(`Lỗi: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleCopy() {
    try {
      const info = extractProductInfo();
      if (!info.title) throw new Error('Không tìm thấy thông tin sản phẩm');
      await copyInfo(info);
      setStatus('Đã copy vào clipboard!');
    } catch (err) {
      setStatus(`Lỗi: ${err.message}`);
    }
  }

  // --- Observer ---

  function init() {
    injectPanel();
    const observer = new MutationObserver(() => {
      if (location.pathname.includes(PDP_PATH) && !document.getElementById(PANEL_ID)) {
        injectPanel();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1500);
  }
})();
