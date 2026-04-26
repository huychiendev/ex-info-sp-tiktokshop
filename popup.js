// Popup script - Lưu cấu hình Telegram vào chrome.storage.local

const $ = (id) => document.getElementById(id);

// Load cấu hình đã lưu khi mở popup
chrome.storage.local.get(['botToken', 'chatId'], (cfg) => {
  if (cfg.botToken) $('botToken').value = cfg.botToken;
  if (cfg.chatId) $('chatId').value = cfg.chatId;
});

$('saveBtn').addEventListener('click', () => {
  const botToken = $('botToken').value.trim();
  const chatId = $('chatId').value.trim();

  if (!botToken || !chatId) {
    $('status').textContent = 'Vui lòng nhập đầy đủ thông tin';
    return;
  }

  chrome.storage.local.set({ botToken, chatId }, () => {
    $('status').textContent = 'Đã lưu thành công!';
    setTimeout(() => { $('status').textContent = ''; }, 2000);
  });
});
