const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION & ADMIN SETUP
// ==========================================
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-5348442720';
const TOTAL_LOTTO_NUMBERS = 3500;

// Track message IDs sent to the group so we can delete them on the next update
let lastGroupMessageIds = [];

// CONFIGURED ADMIN TELEGRAM USER IDs
const ADMIN_IDS = [
  641735093,  // Admin 1
  761311225,  // Admin 2
  1171399514  // Admin 3
];

function isAdmin(userId) {
  if (!userId) return false;
  return ADMIN_IDS.includes(Number(userId));
}

// 1. FILE PERSISTENCE (Atomic Writes)
const DATA_FILE = path.join(__dirname, 'lotto_data.json');
let lottoDatabase = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    lottoDatabase = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading database file, resetting...', e);
    lottoDatabase = {};
  }
}

function saveDatabase() {
  try {
    const tempPath = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(lottoDatabase, null, 2));
    fs.renameSync(tempPath, DATA_FILE);
  } catch (err) {
    console.error('Failed to save database:', err);
  }
}

function getLiveTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `[${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;
}

// 2. TELEGRAM BOT ENGINE
const bot = new Telegraf(process.env.BOT_TOKEN);
const userSessions = {};

// Admin Keyboard layout
const adminKeyboard = Markup.keyboard([
  ['🔍 Check Number', '🎟️ Reserve Number'],
  ['📋 List 3,500 Numbers', '📜 Reserved List'],
  ['❌ Release Number', '📊 Lotto Status Chart']
]).resize();

// Public/Individual User Keyboard layout
const userKeyboard = Markup.keyboard([
  ['🔍 Check Number', '📋 List 3,500 Numbers']
]).resize();

function getMenuKeyboard(userId) {
  return isAdmin(userId) ? adminKeyboard : userKeyboard;
}

function escapeMarkdown(text = '') {
  return text.replace(/[_*`\[\]]/g, '\\$&');
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Helper to clean up previous group posts
async function deletePreviousGroupPosts(tgBotInstance, targetChatId) {
  if (lastGroupMessageIds.length > 0) {
    for (const msgId of lastGroupMessageIds) {
      try {
        await tgBotInstance.telegram.deleteMessage(targetChatId, msgId);
      } catch (err) {
        console.error(`Failed to delete message ${msgId}:`, err.message);
      }
    }
    lastGroupMessageIds = [];
  }
}

// Fixed Batch Dispatcher: 200 numbers/batch with safer delays to prevent rate-limit cuts at 1900
async function sendFullList(tgBotInstance, targetChatId, trackGroupMessages = false) {
  const BATCH_SIZE = 200; // Expanded batch size to stay under Telegram's message-limit throttle
  const liveDate = getLiveTimestamp();
  const sentMessageIds = [];

  for (let start = 1; start <= TOTAL_LOTTO_NUMBERS; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, TOTAL_LOTTO_NUMBERS);
    let batchText = `💥 *${start} ➡️ ${end}*  🕒 _Generated: ${liveDate}_\n\n`;

    for (let i = start; i <= end; i++) {
      const numStr = String(i);
      if (lottoDatabase[numStr]) {
        const phone = lottoDatabase[numStr].phone || '0000000000';
        const hiddenPhone = phone.length > 2 ? phone.slice(0, -2) + 'XX' : 'XX';
        batchText += `🔴 *${numStr}* ⏩ \`${hiddenPhone}\` >>> ✅\n`;
      } else {
        batchText += `🟢 *${numStr}* ⏩\n`;
      }
    }

    try {
      const sentMsg = await tgBotInstance.telegram.sendMessage(targetChatId, batchText, { parse_mode: 'Markdown' });
      if (trackGroupMessages && sentMsg) {
        sentMessageIds.push(sentMsg.message_id);
      }
      // Increased delay to 800ms to safely bypass Telegram API rate limiter
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error(`Failed to send batch ${start}-${end}:`, err);
    }
  }

  return sentMessageIds;
}

// ==========================================
// COMMAND & ACTION HANDLERS
// ==========================================

bot.start((ctx) => {
  const userId = ctx.from.id;
  const greetingText = `Welcome to Guse Car Ekub\n` +
                       `እንኳን ወደ ጉሴ የመኪና እጣ በሰላም መጡ\n` +
                       `Baga Gara uqqubi konkolaata Gusetti Nagayaan Dhuftani`;
  
  ctx.replyWithMarkdown(greetingText, getMenuKeyboard(userId));
});

bot.hears('🔍 Check Number', (ctx) => {
  userSessions[ctx.from.id] = { action: 'CHECK_NUMBER' };
  ctx.reply('Enter number', getMenuKeyboard(ctx.from.id));
});

bot.hears('🎟️ Reserve Number', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ *ACCESS DENIED:* Only system administrators can reserve numbers.', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
  }
  userSessions[ctx.from.id] = { action: 'RESERVE_STEP_NUMBER' };
  ctx.reply(`🛠️ *Booking Configuration started.*\n\n🚩 *Step [1 / 4]:* Enter the desired Number (1-${TOTAL_LOTTO_NUMBERS}):`, getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
});

bot.hears(['📋 List 3,500 Numbers', '📋 List 3,000 Numbers'], async (ctx) => {
  const processMsg = await ctx.reply('⏳ *Initializing live layout engine...* 0%');
  
  setTimeout(() => ctx.telegram.editMessageText(ctx.chat.id, processMsg.message_id, null, '⚡ *Processing database entities...* 50%', { parse_mode: 'Markdown' }).catch(() => {}), 400);
  setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, processMsg.message_id).catch(() => {}), 800);

  await new Promise((resolve) => setTimeout(resolve, 850));
  await sendFullList(bot, ctx.chat.id);
  ctx.reply(`🏁 *All ${TOTAL_LOTTO_NUMBERS.toLocaleString()} entries have been mapped.* 🔥`, getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
});

bot.hears('📜 Reserved List', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ *ACCESS DENIED:* Only system administrators can view detailed reservation records.', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
  }

  const reservedKeys = Object.keys(lottoDatabase).sort((a, b) => Number(a) - Number(b));

  if (reservedKeys.length === 0) {
    return ctx.reply('📑 *RESERVATION DATABASE EMPTY:* No slots are currently booked.', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
  }

  await ctx.reply(`📋 *FETCHING RESERVATIONS...*\nFound *${reservedKeys.length}* booked numbers. Generating report...`, { parse_mode: 'Markdown' });

  let messageChunk = `📄 *ADMIN DETAILED RESERVATION LIST*\n\n`;
  const MAX_CHAR_LIMIT = 3500;

  for (const num of reservedKeys) {
    const entry = lottoDatabase[num];
    const formattedDate = formatDate(entry.timestamp);

    const recordText = `🎟️ *Ticket #${num}*\n` +
                       `👤 *Name:* ${entry.name || 'N/A'}\n` +
                       `📞 *Phone:* \`${entry.phone || 'N/A'}\`\n` +
                       `📍 *Address:* ${entry.address || 'N/A'}\n` +
                       `📅 *Date:* ${formattedDate}\n` +
                       `-----------------------------------\n`;

    if ((messageChunk + recordText).length > MAX_CHAR_LIMIT) {
      await ctx.reply(messageChunk, { parse_mode: 'Markdown' });
      messageChunk = '';
    }

    messageChunk += recordText;
  }

  if (messageChunk.trim().length > 0) {
    await ctx.reply(messageChunk, { parse_mode: 'Markdown' });
  }

  ctx.reply('✅ *Full reservation records delivered successfully.*', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
});

bot.hears('❌ Release Number', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ *ACCESS DENIED:* Only system administrators can release numbers.', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
  }
  userSessions[ctx.from.id] = { action: 'RELEASE_NUMBER' };
  ctx.reply('⚙️ *Database Eraser Active...*\n\nType the locked Number you want to completely wipe out and release:', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
});

bot.hears('📊 Lotto Status Chart', (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ *ACCESS DENIED:* Only system administrators can view metrics.', getMenuKeyboard(ctx.from.id), { parse_mode: 'Markdown' });
  }

  const reservedCount = Object.keys(lottoDatabase).length;
  const availableCount = TOTAL_LOTTO_NUMBERS - reservedCount;
  const percentage = Math.round((reservedCount / TOTAL_LOTTO_NUMBERS) * 100);

  const progressBarLength = 10;
  const filledBlocks = Math.round((percentage / 100) * progressBarLength);
  const emptyBlocks = progressBarLength - filledBlocks;
  const chartBar = '🔥'.repeat(filledBlocks) + '❄️'.repeat(emptyBlocks);

  const statusText = `📊 📈 *LIVE SYSTEM STATUS MATRIX* 📈 📊\n\n` +
                     `⚡ Progress: |${chartBar}| *${percentage}% Completed*\n\n` +
                     `🔴 Total Sold: *${reservedCount} Slots*\n` +
                     `🟢 Total Vacant: *${availableCount} Slots*\n` +
                     `💎 Pool Size: *${TOTAL_LOTTO_NUMBERS} Options*`;

  ctx.replyWithMarkdown(statusText, getMenuKeyboard(ctx.from.id));
});

// ==========================================
// TEXT INPUT INTERCEPTOR & AUTH PROTECTION
// ==========================================

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  const text = ctx.message.text.trim();

  if (['🔍 Check Number', '🎟️ Reserve Number', '📋 List 3,500 Numbers', '📋 List 3,000 Numbers', '📜 Reserved List', '❌ Release Number', '📊 Lotto Status Chart'].includes(text)) {
    delete userSessions[userId];
    return; 
  }

  if (!session) return;

  const numCheck = parseInt(text, 10);
  const requiresValidNum = ['CHECK_NUMBER', 'RESERVE_STEP_NUMBER', 'RELEASE_NUMBER'].includes(session.action);

  if (requiresValidNum && (isNaN(numCheck) || numCheck < 1 || numCheck > TOTAL_LOTTO_NUMBERS)) {
    delete userSessions[userId];
    return ctx.reply(`⚠️ *ALERT: Invalid Number!* Inputs must fall between 1 and ${TOTAL_LOTTO_NUMBERS}. Session cleared.`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'CHECK_NUMBER') {
    delete userSessions[userId];
    if (lottoDatabase[text]) {
      return ctx.reply(`Number ${text} is TAKEN 🔴`, getMenuKeyboard(userId));
    }
    return ctx.reply(`Number ${text} is AVAILABLE 🟢`, getMenuKeyboard(userId));
  }

  if ((session.action === 'RELEASE_NUMBER' || session.action.startsWith('RESERVE_STEP')) && !isAdmin(userId)) {
    delete userSessions[userId];
    return ctx.reply('⛔ *ACCESS DENIED:* Unauthorized action attempt.', getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'RELEASE_NUMBER') {
    delete userSessions[userId];
    if (lottoDatabase[text]) {
      delete lottoDatabase[text];
      saveDatabase();
      return ctx.reply(`✨ *WIPE COMPLETE:* Number *${text}* is now available!`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });
    }
    return ctx.reply(`⚠️ *NOTICE:* Number *${text}* was already vacant.`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'RESERVE_STEP_NUMBER') {
    if (lottoDatabase[text]) {
      delete userSessions[userId];
      return ctx.reply(`❌ *DENIED:* Slot *${text}* is taken. Wizard cancelled.`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });
    }
    userSessions[userId] = { action: 'RESERVE_STEP_NAME', targetNumber: text };
    return ctx.reply(`👤 *Step [2 / 4]:* Enter customer's *Full Name* for Ticket *#${text}*:`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'RESERVE_STEP_NAME') {
    session.name = escapeMarkdown(text);
    session.action = 'RESERVE_STEP_PHONE';
    return ctx.reply('📞 *Step [3 / 4]:* Submit their *Phone Number*:', getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'RESERVE_STEP_PHONE') {
    session.phone = escapeMarkdown(text);
    session.action = 'RESERVE_STEP_ADDRESS';
    return ctx.reply('📍 *Step [4 / 4]:* Provide their *Full Delivery Address*:', getMenuKeyboard(userId), { parse_mode: 'Markdown' });
  }

  if (session.action === 'RESERVE_STEP_ADDRESS') {
    const target = session.targetNumber;
    lottoDatabase[target] = {
      name: session.name,
      phone: session.phone,
      address: escapeMarkdown(text),
      timestamp: new Date().toISOString()
    };
    saveDatabase();
    delete userSessions[userId];

    ctx.reply(`🎉 *BOOKING CONCLUDED!* Ticket *#${target}* secured for *${session.name}*!`, getMenuKeyboard(userId), { parse_mode: 'Markdown' });

    const reservedCount = Object.keys(lottoDatabase).length;
    if (reservedCount > 0 && reservedCount % 10 === 0) {
      try {
        await deletePreviousGroupPosts(bot, TELEGRAM_GROUP_ID);

        const announcementMsg = await bot.telegram.sendMessage(
          TELEGRAM_GROUP_ID, 
          `📢 *MILESTONE HIT:* \`${reservedCount}\` tickets sold! Updating group...`, 
          { parse_mode: 'Markdown' }
        );

        const newBatchMsgIds = await sendFullList(bot, TELEGRAM_GROUP_ID, true);

        lastGroupMessageIds = [announcementMsg.message_id, ...newBatchMsgIds];
      } catch (groupError) {
        console.error('Group dispatch error:', groupError);
      }
    }
  }
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Car Lotto Bot Status: Active'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}. Starting bot...`);
  bot.launch()
    .then(() => console.log('Telegram Bot running via Long Polling.'))
    .catch((err) => console.error('Bot launch failed:', err));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
