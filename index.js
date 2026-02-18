
// ====== CONFIG BASE ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SERVER_ID = process.env.SERVER_ID;

// =========================

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require('quick.db');
const cron = require('node-cron');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = new QuickDB();
const app = express();





app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const path = require('path');

// serve tutti i file statici dentro /public
app.use(express.static(path.join(__dirname, 'public')));

// quando vai su /dashboard, manda l'HTML
app.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ====== DASHBOARD SEMPLICE ======
app.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/api/reminders', async (req, res) => {
  try {
    const all = await db.all();
    const reminders = all.filter(e => String(e.id).startsWith('reminder_'));
    res.json(reminders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nel leggere i reminder' });
  }
});



app.listen(3000, () => console.log('Dashboard: http://localhost:3000/dashboard'));

// ====== FUNZIONE SCHEDULING ======
async function scheduleReminder(reminderId) {
  const reminder = await db.get(reminderId);
  if (!reminder) return;

  const [hour, minute] = reminder.time.split(':');

  // Se days è vuoto → ogni giorno (*), altrimenti usa direttamente i numeri 1-7 separati da virgola
  const dayOfWeek = reminder.days && reminder.days.trim() !== ''
    ? reminder.days                  // es. "1,3" → lunedì e mercoledì
    : '*';                           // tutti i giorni

  // min ora giorno mese giornoSettimana
  const expr = `${minute} ${hour} * * ${dayOfWeek}`;

  const tz = reminder.timezone || 'UTC';

  cron.schedule(expr, async () => {
    const guild = client.guilds.cache.get(reminder.guildId);
    if (!guild) return;
    const ch = guild.channels.cache.get(reminder.channel);
    if (!ch) return;

    if (reminder.times === -1 || reminder.sent < reminder.times) {
      await ch.send(reminder.message);
      reminder.sent = (reminder.sent || 0) + 1;
      await db.set(reminderId, reminder);
    } else {
      await db.delete(reminderId);
    }
  }, { timezone: tz });
}



// ====== HANDLER INTERAZIONI ======
client.on('interactionCreate', async (interaction) => {
  // 1) Prima gestiamo i BOTTONI
  if (interaction.isButton()) {
    if (interaction.customId === 'confirm_delete_all') {
      const all = await db.all();
      const reminders = all.filter(e => String(e.id).startsWith('reminder_'));
      for (const r of reminders) {
        await db.delete(r.id);
      }
      await interaction.update({
        content: '✅ Tutti i reminder sono stati cancellati.',
        components: []
      });
    }

    if (interaction.customId === 'cancel_delete_all') {
      await interaction.update({
        content: '❎ Operazione annullata, nessun reminder cancellato.',
        components: []
      });
    }

    return; // finita la parte bottoni
  }

// /settimezone
  if (interaction.commandName === 'settimezone') {
    const tz = interaction.options.getString('timezone');
    await db.set(`tz_${interaction.guild.id}`, tz);
    await interaction.reply(`Timezone impostato a: **${tz}**`);
    return;
  }

// /setreminder

    if (interaction.commandName === 'setreminder') {
    const channel = interaction.options.getChannel('channel');
    const time = interaction.options.getString('time');
    const message = interaction.options.getString('message');
    const times = interaction.options.getInteger('times') ?? -1;
    const days = interaction.options.getString('days') || '';   // ← qui

    const id = `reminder_${Date.now()}`;

    const guildTz = await db.get(`tz_${interaction.guild.id}`) || 'UTC';

    await db.set(id, {
        guildId: interaction.guild.id,
        channel: channel.id,
        time,
        repeat: 'everyday',
        times,
        sent: 0,
        message,
        timezone: guildTz,               // salva Timezone
        days: days                       // ← salva stringa tipo "1,3"
    });

    scheduleReminder(id);

    await interaction.reply('✅ Reminder creato!');
    return;
    }


// /reminderlist
  if (interaction.commandName === 'reminderlist') {
    const all = await db.all();
    const reminders = all.filter(e => String(e.id).startsWith('reminder_'));
    if (!reminders.length) {
      await interaction.reply('Nessun reminder.');
      return;
    }

    const desc = reminders
      .map((r, i) => `${i + 1}. ${r.value.message} (${r.value.time})`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🔔 Lista reminder')
      .setDescription(desc);

    await interaction.reply({ embeds: [embed] });
    return;
  }

// /remindercanc
  if (interaction.commandName === 'remindercanc') {
    const index = interaction.options.getInteger('numero') - 1;

    const all = await db.all();
    const reminders = all.filter(e => String(e.id).startsWith('reminder_'));

    if (!reminders[index]) {
      await interaction.reply('Numero non valido.');
      return;
    }

    await db.delete(reminders[index].id);
    await interaction.reply('❌ Reminder cancellato.');
  }

// /remindercancall
  if (interaction.commandName === 'remindercancall') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_delete_all')
        .setLabel('Sì, cancella tutto')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel_delete_all')
        .setLabel('No, annulla')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: 'Sei sicuro di voler cancellare **tutti** i reminder?',
      components: [row],
      ephemeral: true
    });
    return;
  }

// /help
  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Help – Reminder Bot')
      .setColor(0x1f8fff)
      .setDescription([
        '**/settimezone `<timezone>`**',
        'Imposta il fuso orario (es. `UTC`, `Europe/Rome`).',
        '',
        '**/setreminder `<channel>` `<time>` `<message>` `[times]` `[days]`**',
        'Crea un promemoria. `time` è HH:MM, `times` quante volte (-1 = infinito),',
        '`days` sono i giorni della settimana 1-7 (es. `1,3` = lunedì e mercoledì).',
        '',
        '**/reminderlist**',
        'Mostra tutti i promemoria salvati.',
        '',
        '**/remindercanc `<numero>`**',
        'Cancella il promemoria con quel numero (dalla lista).',
        '',
        '**/remindercancall**',
        'Chiede conferma e poi cancella tutti i promemoria.',
      ].join('\n'))
      .setFooter({ text: 'Suggerimento: usa UTC come timezone se il bot gira su un server estero.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }


});



// ====== DEFINIZIONE COMANDI ======
const commands = [
  new SlashCommandBuilder()
    .setName('settimezone')
    .setDescription('Imposta il fuso orario (solo salvato, per ora)')
    .addStringOption(o =>
      o.setName('timezone')
        .setDescription('Es: Europe/Rome')
        .setRequired(true)
    ),

    new SlashCommandBuilder()
    .setName('setreminder')
    .setDescription('Crea un promemoria')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Canale dove inviare il messaggio')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('time')
        .setDescription('Ora HH:MM (24h)')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Testo del promemoria')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('times')
        .setDescription('Quante volte (lascia vuoto per infinito)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('days')
        .setDescription('Giorni settimana 1-7, es: 1,3 per lunedì e mercoledì')
        .setRequired(false)
    ),


  new SlashCommandBuilder()
    .setName('reminderlist')
    .setDescription('Mostra tutti i reminder'),

  new SlashCommandBuilder()
    .setName('remindercanc')
    .setDescription('Cancella reminder per numero nella lista')
    .addIntegerOption(o =>
      o.setName('numero')
        .setDescription('Numero dalla lista')
        .setRequired(true)
    ),

    new SlashCommandBuilder()
        .setName('remindercancall')
        .setDescription('Cancella tutti i reminder salvati'),


    new SlashCommandBuilder()
    .setName('help')
    .setDescription('Mostra la lista dei comandi del bot'),



].map(cmd => cmd.toJSON());

// ====== REGISTRA COMANDI E AVVIA BOT ======
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function start() {
  try {
    console.log('Registrazione comandi slash...');
    // Guild commands (più veloci da aggiornare)
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, SERVER_ID),
      { body: commands },
    );
    console.log('✅ Comandi registrati.');

    await client.login(TOKEN);
    console.log('✅ Bot online!');
  } catch (err) {
    console.error(err);
  }
}

start();
