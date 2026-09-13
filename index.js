const { Telegraf } = require('telegraf');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

// This web route gives UptimeRobot something to ping
app.get('/', (req, res) => res.send('Bot is Awake!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

bot.start((ctx) => ctx.reply('👋 Hello! Your bot is live on Render 24/7!'));
bot.on('text', (ctx) => ctx.reply(`🤖 You sent: "${ctx.message.text}"`));

bot.launch()
  .then(() => console.log('Telegram Bot Polling started.'))
  .catch((err) => console.error('Bot Error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
