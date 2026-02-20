// ====== CONFIG BASE ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SERVER_ID = process.env.SERVER_ID;

// DB
const DB_HOST = process.env.MYSQLHOST || process.env.DB_HOST;
const DB_USER = process.env.MYSQLUSER || process.env.DB_USER;
const DB_PASS = process.env.MYSQLPASSWORD || process.env.DB_PASS;
const DB_NAME = process.env.MYSQLDATABASE || process.env.DB_NAME;


// =========================

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const cron = require('node-cron');
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise'); // mysql2/promise [web:30][web:39]

// ====== POOL MYSQL ======
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ====== DISCORD CLIENT ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ====== EXPRESS APP ======
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// serve tutti i file statici dentro /public
app.use(express.static(path.join(__dirname, 'public')));

// quando vai su /dashboard, manda l'HTML
app.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== ENDPOINT DASHBOARD: AGGIUNTA REMINDER ======
app.post('/add', async (req, res) => {
  try {
    const id = Date.now();

    await pool.execute(
      `INSERT INTO reminders
       (id, guild_id, channel_id, time_hhmm, repeat_type, max_times, sent_count, message, timezone, days)
       VALUES (?, ?, ?, ?, 'everyday', -1, 0, ?, 'UTC', '')`,
      [
        id,
        SERVER_ID,
        req.body.channel,
        req.body.time,
        req.body.message,
      ]
    );

    scheduleReminder(id);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Errore in /add:', err);
    res.status(500).send('Errore nel creare il reminder');
  }
});

// ====== API REMINDERS PER DASHBOARD ======
app.get('/api/reminders', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM reminders');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nel leggere i reminder' });
  }
});

app.listen(3000, () => console.log('Dashboard: http://localhost:3000/dashboard'));

// ====== FUNZIONE SCHEDULING ======
async function scheduleReminder(reminderId) {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM reminders WHERE id = ?',
      [reminderId]
    );
    if (!rows.length) return;

    const reminder = rows[0];

    const [hour, minute] = reminder.time_hhmm.split(':');

    const dayOfWeek = reminder.days && reminder.days.trim() !== ''
      ? reminder.days
      : '*';

    const expr = `${minute} ${hour} * * ${dayOfWeek}`;

    const tz = reminder.timezone || 'UTC';

    cron.schedule(expr, async () => {
      try {
        const guild = client.guilds.cache.get(reminder.guild_id);
        if (!guild) return;
        const ch = guild.channels.cache.get(reminder.channel_id);
        if (!ch) return;

        if (reminder.max_times === -1 || reminder.sent_count < reminder.max_times) {
          await ch.send(reminder.message);

          reminder.sent_count = (reminder.sent_count || 0) + 1;

          await pool.execute(
            'UPDATE reminders SET sent_count = ? WHERE id = ?',
            [reminder.sent_count, reminderId]
          );
        } else {
          await pool.execute(
            'DELETE FROM reminders WHERE id = ?',
            [reminderId]
          );
        }
      } catch (err) {
        console.error('Errore nel job cron:', err);
      }
    }, { timezone: tz });

  } catch (err) {
    console.error('Errore in scheduleReminder:', err);
  }
}

// ====== HANDLER INTERAZIONI ======
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // 1) BOTTONI
  if (interaction.isButton()) {
    if (interaction.customId === 'confirm_delete_all') {
      try {
        await pool.execute(
          'DELETE FROM reminders WHERE guild_id = ?',
          [interaction.guild.id]
        );

        await interaction.update({
          content: '✅ Tutti i reminder sono stati cancellati.',
          components: []
        });
      } catch (err) {
        console.error('Errore cancellazione tutti i reminder:', err);
        await interaction.update({
          content: '❌ Errore durante la cancellazione dei reminder.',
          components: []
        });
      }
    }

    if (interaction.customId === 'cancel_delete_all') {
      await interaction.update({
        content: '❎ Operazione annullata, nessun reminder cancellato.',
        components: []
      });
    }

    return;
  }

  // 2) COMANDI SLASH

  // /settimezone
  if (interaction.commandName === 'settimezone') {
    const tz = interaction.options.getString('timezone');

    try {
      await pool.execute(
        `INSERT INTO guild_timezones (guild_id, timezone)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)`,
        [interaction.guild.id, tz]
      );

      await interaction.reply(`Timezone impostato a: **${tz}**`);
    } catch (err) {
      console.error('Errore settimezone:', err);
      await interaction.reply('❌ Errore nel salvataggio della timezone.');
    }

    return;
  }

  // /setreminder
  if (interaction.commandName === 'setreminder') {
    const channel = interaction.options.getChannel('channel');
    const time = interaction.options.getString('time');
    const message = interaction.options.getString('message');
    const times = interaction.options.getInteger('times') ?? -1;
    const days = interaction.options.getString('days') || '';

    let guildTz = 'UTC';

    try {
      const [tzRows] = await pool.execute(
        'SELECT timezone FROM guild_timezones WHERE guild_id = ?',
        [interaction.guild.id]
      );
      if (tzRows.length) guildTz = tzRows[0].timezone;
    } catch (err) {
      console.error('Errore lettura timezone:', err);
    }

    try {
      const id = Date.now();

      await pool.execute(
        `INSERT INTO reminders
         (id, guild_id, channel_id, time_hhmm, repeat_type, max_times, sent_count, message, timezone, days)
         VALUES (?, ?, ?, ?, 'everyday', ?, 0, ?, ?, ?)`,
        [
          id,
          interaction.guild.id,
          channel.id,
          time,
          times,
          message,
          guildTz,
          days,
        ]
      );

      scheduleReminder(id);

      await interaction.reply('✅ Reminder creato!');
    } catch (err) {
      console.error('Errore setreminder:', err);
      await interaction.reply('❌ Errore nella creazione del reminder.');
    }

    return;
  }

  // /reminderlist
  if (interaction.commandName === 'reminderlist') {
    try {
      const [reminders] = await pool.execute(
        'SELECT * FROM reminders WHERE guild_id = ? ORDER BY id',
        [interaction.guild.id]
      );

      if (!reminders.length) {
        await interaction.reply('Nessun reminder.');
        return;
      }

      const desc = reminders
        .map((r, i) => `${i + 1}. ${r.message} (${r.time_hhmm})`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🔔 Lista reminder')
        .setDescription(desc);

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Errore reminderlist:', err);
      await interaction.reply('❌ Errore nel recupero dei reminder.');
    }

    return;
  }

  // /remindercanc
  if (interaction.commandName === 'remindercanc') {
    const index = interaction.options.getInteger('numero') - 1;

    try {
      const [reminders] = await pool.execute(
        'SELECT id, message, time_hhmm FROM reminders WHERE guild_id = ? ORDER BY id',
        [interaction.guild.id]
      );

      if (!reminders[index]) {
        await interaction.reply('Numero non valido.');
        return;
      }

      const reminder = reminders[index];

      await pool.execute('DELETE FROM reminders WHERE id = ?', [reminder.id]);

      await interaction.reply('❌ Reminder cancellato.');
    } catch (err) {
      console.error('Errore remindercanc:', err);
      await interaction.reply('❌ Errore nella cancellazione del reminder.');
    }

    return;
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
    .setDescription('Imposta il fuso orario')
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
