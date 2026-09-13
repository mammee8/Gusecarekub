const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==========================================
// TARGET CHAT CONFIGURATION
// ==========================================
const TELEGRAM_GROUP_ID = '-5348442720'; 

// 1. FILE PERSISTENCE ENGINE
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(lottoDatabase, null, 2));
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `[${day}/${month}/${year} ${hours}:${minutes}]`;
}

// 2. TELEGRAM BOT ENGINE INITIALIZATION
const bot = new Telegraf(process.env.BOT_TOKEN);
const userSessions = {};

// Color-coded tab layouts
const mainKeyboard = Markup.keyboard([
  ['🔍 Check Number', '🎟️ Reserve Number'],
  ['📋 List 3,000 Numbers'],
  ['❌ Release Number', '📊 Lotto Status Chart']
]).resize();

const greetingText = `🏎️💨 *WELCOME TO THE PREMIUM CAR LOTTERY MANAGEMENT SYSTEM* 💨🏎️\n\n` +
                       `✨ _Tap a colorful command tab below to control the live system:_ ✨`;

bot.start((ctx) => {
  ctx.replyWithMarkdown(greetingText, mainKeyboard);
});

// Master generator for sending all 3000 entries efficiently
async function sendFullList(tgBotInstance, targetChatId) {
  const TOTAL_NUMBERS = 3000;
  const BATCH_SIZE = 50;
  
  for (let start = 1; start <= TOTAL_NUMBERS; start += BATCH_SIZE) {
    let end = Math.min(start + BATCH_SIZE - 1, TOTAL_NUMBERS);
    let batchText = `💥 *${start} ➡️ ${end}* 💥\n\n`;
    
    for (let i = start; i <= end; i++) {
      const numStr = String(i);
      if (lottoDatabase[numStr]) {
        const phone = lottoDatabase[numStr].phone || '0000000000';
        const hiddenPhone = phone.length > 2 ? phone.slice(0, -2) + 'XX' : 'XX';
        const dateStr = formatTimestamp(lottoDatabase[numStr].timestamp);
        
        // Output structure: Number >>> Phone [Timestamp] >>> ✅
        batchText += `🔴 *${numStr}* ⏩ \`${hiddenPhone}\` ${dateStr} >>> ✅\n`;
      } else {
        batchText += `🟢 *${numStr}* ⏩ \`⚡ Available\` ✨\n`;
      }
    }
    
    try {
      await tgBotInstance.telegram.sendMessage(targetChatId, batchText, { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 150)); 
    } catch (err) {
      console.error(`Failed to send batch ${start}-${end}:`, err);
    }
  }
}

// --- TAB 1: CHECK NUMBER ---
bot.hears('🔍 Check Number', (ctx) => {
  ctx.reply('🔎 *Scanning Input...* Please type the Number you want to check (1-3000):', { parse_mode: 'Markdown' });
  userSessions[ctx.from.id] = { action: 'CHECK_NUMBER' };
});

// --- TAB 2: RESERVE NUMBER ---
bot.hears('🎟️ Reserve Number', (ctx) => {
  ctx.reply('🛠️ *Booking Configuration started.*\n\n🚩 *Step [1 / 4]:* Enter the desired Number (1-3000):', { parse_mode: 'Markdown' });
  userSessions[ctx.from.id] = { action: 'RESERVE_STEP_NUMBER' };
});

// --- TAB 3: LIST NUMBERS ---
bot.hears('📋 List 3,000 Numbers', async (ctx) => {
  const processMsg = await ctx.reply('⏳ *Initializing live layout engine...* 0%');
  setTimeout(() => ctx.telegram.editMessageText(ctx.chat.id, processMsg.message_id, null, '⚡ *Processing 3,000 database entities...* 45%', { parse_mode: 'Markdown' }).catch(()=>{}), 400);
  setTimeout(() => ctx.telegram.editMessageText(ctx.chat.id, processMsg.message_id, null, '🚀 *Formatting structures and timestamps...* 90%', { parse_mode: 'Markdown' }).catch(()=>{}), 800);
  setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, processMsg.message_id).catch(()=>{}), 1200);

  await new Promise(resolve => setTimeout(resolve, 1250));
  await sendFullList(bot, ctx.chat.id);
  ctx.reply('🏁 *All 3,000 entries have been mapped perfectly.* 🔥', mainKeyboard, { parse_mode: 'Markdown' });
});

// --- TAB 4: RELEASE NUMBER ---
bot.hears('❌ Release Number', (ctx) => {
  ctx.reply('⚙️ *Database Eraser Active...*\n\nType the locked Number you want to completely wipe out and release:', { parse_mode: 'Markdown' });
  userSessions[ctx.from.id] = { action: 'RELEASE_NUMBER' };
});

// --- TAB 5: LOTTO STATUS CHART ---
bot.hears('📊 Lotto Status Chart', (ctx) => {
  const totalNumbers = 3000;
  const reservedCount = Object.keys(lottoDatabase).length;
  const availableCount = totalNumbers - reservedCount;
  const percentage = Math.round((reservedCount / totalNumbers) * 100);

  const progressBarLength = 10;
  const filledBlocks = Math.round((percentage / 100) * progressBarLength);
  const emptyBlocks = progressBarLength - filledBlocks;
  const chartBar = '🔥'.repeat(filledBlocks) + '❄️'.repeat(emptyBlocks);

  const statusText = `📊 📈 *LIVE SYSTEM STATUS MATRIX* 📈 📊\n\n` +
                     `⚡ Progress: |${chartBar}| *${percentage}% Completed*\n\n` +
                     `🔴 Total Sold: *${reservedCount} Slots*\n` +
                     `🟢 Total Vacant: *${availableCount} Slots*\n` +
                     `💎 Pool Size: *${totalNumbers} Options*`;

  ctx.replyWithMarkdown(statusText, mainKeyboard);
});

// --- TEXT INPUT ROUTING INTERCEPTOR ---
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  const text = ctx.message.text.trim();

  if (!session) return;

  const numCheck = parseInt(text);
  if ((session.action === 'CHECK_NUMBER' || session.action === 'RESERVE_STEP_NUMBER' || session.action === 'RELEASE_NUMBER') && (isNaN(numCheck) || numCheck < 1 || numCheck > 3000)) {
    ctx.reply('⚠️ *ALERT: Invalid Number!* Inputs must fall between 1 and 3000. Session cleared.', mainKeyboard, { parse_mode: 'Markdown' });
    delete userSessions[userId];
    return;
  }

  if (session.action === 'CHECK_NUMBER') {
    if (lottoDatabase[text]) {
      ctx.reply(`🔒 *STATUS CHECK:* Number *${text}* is already *TAKEN & LOCKED*!`, mainKeyboard, { parse_mode: 'Markdown' });
    } else {
      ctx.reply(`⚡ *STATUS CHECK:* Number *${text}* is 🌟 *AVAILABLE NOW* 🌟!`, mainKeyboard, { parse_mode: 'Markdown' });
    }
    delete userSessions[userId];
    return;
  }

  if (session.action === 'RELEASE_NUMBER') {
    if (lottoDatabase[text]) {
      delete lottoDatabase[text];
      saveDatabase();
      ctx.reply(`✨ *WIPE COMPLETE:* Number *${text}* has broken out of its reservation and is open!`, mainKeyboard, { parse_mode: 'Markdown' });
    } else {
      ctx.reply(`⚠️ *NOTICE:* Number *${text}* was already completely vacant.`, mainKeyboard, { parse_mode: 'Markdown' });
    }
    delete userSessions[userId];
    return;
  }

  if (session.action === 'RESERVE_STEP_NUMBER') {
    if (lottoDatabase[text]) {
      ctx.reply(`❌ *DENIED:* Sorry, Slot *${text}* is completely taken. Wizard cancelled.`, mainKeyboard, { parse_mode: 'Markdown' });
      delete userSessions[userId];
      return;
    }
    userSessions[userId] = { action: 'RESERVE_STEP_NAME', targetNumber: text };
    ctx.reply(`👤 *Step [2 / 4]:* Enter the customer's *Full Name* for Ticket *#${text}*:`, { parse_mode: 'Markdown' });
    return;
  }

  if (session.action === 'RESERVE_STEP_NAME') {
    session.name = text;
    session.action = 'RESERVE_STEP_PHONE';
    ctx.reply('📞 *Step [3 / 4]:* Please submit their *Phone Number*:', { parse_mode: 'Markdown' });
    return;
  }

  if (session.action === 'RESERVE_STEP_PHONE') {
    session.phone = text;
    session.action = 'RESERVE_STEP_ADDRESS';
    ctx.reply('📍 *Step [4 / 4]:* Final step! Provide their *Full Delivery Address*:', { parse_mode: 'Markdown' });
    return;
  }

  if (session.action === 'RESERVE_STEP_ADDRESS') {
    const target = session.targetNumber;
    lottoDatabase[target] = {
      name: session.name,
      phone: session.phone,
      address: text,
      timestamp: new Date().toISOString()
    };
    saveDatabase();
    ctx.reply(`🎉 *BOOKING CONCLUDED!* Ticket *#${target}* successfully secured for *${session.name}*!`, mainKeyboard, { parse_mode: 'Markdown' });
    
    const currentReservedCount = Object.keys(lottoDatabase).length;
    if (currentReservedCount > 0 && currentReservedCount % 10 === 0) {
      try {
        await bot.telegram.sendMessage(TELEGRAM_GROUP_ID, `📢 *MILESTONE HIT:* \`${currentReservedCount}\` tickets sold! Dispatching updated 3K list...`, { parse_mode: 'Markdown' });
        await sendFullList(bot, TELEGRAM_GROUP_ID);
      } catch (groupError) {
        console.error('Group dispatch error:', groupError);
      }
    }

    delete userSessions[userId];
    return;
  }
});

// 3. SECURE STARTUP ORDER (Express starts first to satisfy Render's health port, then Telegram triggers)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Car Lotto Bot Status: Active'));

app.listen(PORT, () => {
  console.log(`Web cluster responsive on port ${PORT}. Booting polling engine...`);
  
  bot.launch()
    .then(() => console.log('Telegram matrix live.'))
    .catch(err => console.error('Launch execution failure:', err));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
