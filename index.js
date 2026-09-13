const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// 1. RENDER SERVER CONFIG (Keeps the bot awake)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Car Lotto Bot is Awake!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// 2. DATABASE CONFIG (Saves your lotto data to a local file)
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

// 3. TELEGRAM BOT INIT
const bot = new Telegraf(process.env.BOT_TOKEN);

// User session state tracker for multi-step text inputs on Android
const userSessions = {};

// Main Menu Keyboards (The 5 Custom Tabs)
const mainKeyboard = Markup.keyboard([
  ['1️⃣ Check Number', '2️⃣ Reserve Number'],
  ['3️⃣ List Numbers', '4️⃣ Release Number'],
  ['5️⃣ Lotto Status']
]).resize();

// Command handler when /start is typed
bot.start((ctx) => {
  ctx.reply('🚗 Welcome to the Car Lottery Management Bot! Select a feature below:', mainKeyboard);
});

// --- TAB 1: CHECK NUMBER ---
bot.hears('1️⃣ Check Number', (ctx) => {
  ctx.reply('Please enter the Lotto Number you want to check:');
  userSessions[ctx.from.id] = { action: 'CHECK_NUMBER' };
});

// --- TAB 2: RESERVE NUMBER ---
bot.hears('2️⃣ Reserve Number', (ctx) => {
  ctx.reply('Step 1/4: Enter the Lotto Number you want to reserve:');
  userSessions[ctx.from.id] = { action: 'RESERVE_STEP_NUMBER' };
});

// --- TAB 3: LIST NUMBERS ---
bot.hears('3️⃣ List Numbers', (ctx) => {
  let responseText = '📋 **Lotto Numbers List:**\n\n';
  
  // Checking a pool of numbers (e.g., numbers 1 through 50)
  for (let i = 1; i <= 50; i++) {
    const numStr = String(i);
    if (lottoDatabase[numStr]) {
      const phone = lottoDatabase[numStr].phone || '0000000000';
      // Omits the last two digits of the phone number
      const hiddenPhone = phone.slice(0, -2) + 'XX';
      responseText += `Lotto ${numStr} >>>>> ${hiddenPhone} ✅\n`;
    } else {
      responseText += `Lotto ${numStr} >>>>> \n`;
    }
  }
  ctx.replyWithMarkdown(responseText);
});

// --- TAB 4: RELEASE NUMBER ---
bot.hears('4️⃣ Release Number', (ctx) => {
  ctx.reply('Enter the Lotto Number you want to release (clear reservation):');
  userSessions[ctx.from.id] = { action: 'RELEASE_NUMBER' };
});

// --- TAB 5: LOTTO STATUS CHART ---
bot.hears('5️⃣ Lotto Status', (ctx) => {
  const totalNumbers = 50; // Customize your maximum number size here
  const reservedCount = Object.keys(lottoDatabase).length;
  const availableCount = totalNumbers - reservedCount;
  const percentage = Math.round((reservedCount / totalNumbers) * 100);

  // Generate visual text bar chart representation
  const progressBarLength = 10;
  const filledBlocks = Math.round((percentage / 100) * progressBarLength);
  const emptyBlocks = progressBarLength - filledBlocks;
  const chartBar = '🟩'.repeat(filledBlocks) + '⬜'.repeat(emptyBlocks);

  const statusText = `📊 **Lottery Status Chart**\n\n` +
                     `📈 Progress: ${chartBar} ${percentage}%\n` +
                     `✅ Reserved Numbers: *${reservedCount}*\n` +
                     `🆓 Available Numbers: *${availableCount}*\n` +
                     `🔢 Total Pool Size: *${totalNumbers}*`;

  ctx.replyWithMarkdown(statusText);
});

// --- TEXT INPUT ROUTING (Handles inputs from text prompts) ---
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];
  const text = ctx.message.text.trim();

  if (!session) return;

  // Handle checking
  if (session.action === 'CHECK_NUMBER') {
    if (lottoDatabase[text]) {
      ctx.reply(`❌ Lotto Number ${text} is ALREADY reserved.`);
    } else {
      ctx.reply(`🟢 Lotto Number ${text} is AVAILABLE!`);
    }
    delete userSessions[userId];
    return;
  }

  // Handle releasing
  if (session.action === 'RELEASE_NUMBER') {
    if (lottoDatabase[text]) {
      delete lottoDatabase[text];
      saveDatabase();
      ctx.reply(`🗑️ Lotto Number ${text} has been successfully released and made available.`);
    } else {
      ctx.reply(`⚠️ Lotto Number ${text} wasn't reserved anyway.`);
    }
    delete userSessions[userId];
    return;
  }

  // Handle multi-step reservation wizard
  if (session.action === 'RESERVE_STEP_NUMBER') {
    if (lottoDatabase[text]) {
      ctx.reply(`❌ Sorry, Lotto ${text} is already taken. Process cancelled.`);
      delete userSessions[userId];
      return;
    }
    userSessions[userId] = { action: 'RESERVE_STEP_NAME', targetNumber: text };
    ctx.reply(`Step 2/4: Enter Full Name for Number ${text}:`);
    return;
  }

  if (session.action === 'RESERVE_STEP_NAME') {
    session.name = text;
    session.action = 'RESERVE_STEP_PHONE';
    ctx.reply('Step 3/4: Enter Phone Number:');
    return;
  }

  if (session.action === 'RESERVE_STEP_PHONE') {
    session.phone = text;
    session.action = 'RESERVE_STEP_ADDRESS';
    ctx.reply('Step 4/4: Enter Full Address:');
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
    ctx.reply(`🎉 Success! Lotto Number ${target} has been registered to ${session.name}.`, mainKeyboard);
    delete userSessions[userId];
    return;
  }
});

// Launch Bot
bot.launch()
  .then(() => console.log('Car Lotto Bot initialized successfully.'))
  .catch(err => console.error('Telegram API Launch Error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
