// ====== CONFIG BASE ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SERVER_ID = process.env.SERVER_ID;
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
const mongoose = require('mongoose');
const path = require('path');

// ====== CLIENT & EXPRESS ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== MONGODB ======
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schema reminder
const reminderSchema = new mongoose.Schema({
  guildId: String,
  channel: String,
  time: String,
  repeat: { type: String, default: 'everyday' },
  times: { type: Number, default: -1 },
  sent: { type: Number, default: 0 },
  message: String,
  timezone: { type: String, default: 'UTC' },
  days: { type: String, default: '' },
});

const Reminder = mongoose.model('Reminder', reminderSchema);

// Schema timezone per server
const guildTzSchema = new mongoose.Schema({
  guildId: { type: String, unique: true },
  timezone: String,
});

const GuildTz = mongoose.model('GuildTz', guildTzSchema);

// ====== DASHBOARD ======
app.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await Reminder.find({});
    res.json(reminders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nel leggere i reminder' });
  }
});

app.listen(3000, () =>
  console.log('Dashboard: http://localhost:3000/dashboard')
);

// ====== FUNZIONE SCHEDULING ======
async function scheduleReminder(reminderId) {
  const reminder = await Reminder.findById(reminderId);
  if (!reminder) return;

  const [hour, minute] = reminder.time.split(':');

  const dayOfWeek =
    reminder.days && reminder.days.trim() !== ''
      ? reminder.days
      : '*';

  // min ora giorno mese giornoSettimana
  const expr = `${minute} ${hour} * * ${dayOfWeek}`;
  const tz = reminder.timezone || 'UTC';

  cron.schedule(
    expr,
    async () => {
      const guild = client.guilds.cache.get(reminder.guildId);
      if (!guild) return;
      const ch = guild.channels.cache.get(reminder.channel);
      if (!ch) return;

      if (reminder.times === -1 || reminder.sent < reminder.times) {
        await ch.send(reminder.message);
        reminder.sent = (reminder.sent || 0) + 1;
        await reminder.save();
      } else {
        await Reminder.findByIdAndDelete(reminderId);
      }
    },
    { timezone: tz }
  );
}

// ====== HANDLER INTERAZIONI ======
client.on('interactionCreate', async (interaction) => {
  // BOTTONI
  if (interaction.isButton()) {
    if (interaction.customId === 'confirm_delete_all') {
      await Reminder.deleteMany({});
      await interaction.update({
        content: '✅ Tutti i reminder sono stati cancellati.',
        components: [],
      });
    }

    if (interaction.customId === 'cancel_delete_all') {
      await interaction.update({
        content: '❎ Operazione annullata, nessun reminder cancellato.',
        components: [],
      });
    }

    return;
  }

  // /settimezone
  if (interaction.commandName === 'settimezone') {
    const tz = interaction.options.getString('timezone');
    await GuildTz.findOneAndUpdate(
      { guildId: interaction.guild.id },
      { timezone: tz },
      { upsert: true }
    );
    await interaction.reply(`Timezone impostato a: **${tz}**`);
    return;
  }

  // /setreminder
  if (interaction.commandName === 'setreminder') {
    const channel = interaction.options.getChannel('channel');
    const time = interaction.options.getString('time');
    const message = interaction.options.getString('message');
    const times = interaction.options.getInteger('times') ?? -1;
    const days = interaction.options.getString('days') || '';

    const guildDoc = await GuildTz.findOne({ guildId: interaction.guild.id });
    const guildTz = guildDoc?.timezone || 'UTC';

    const doc = await Reminder.create({
      guildId: interaction.guild.id,
      channel: channel.id,
      time,
      repeat: 'everyday',
      times,
      sent: 0,
      message,
      timezone: guildTz,
      days: days,
    });

    scheduleReminder(doc._id.toString());

    await interaction.reply('✅ Reminder creato!');
    return;
  }

  // /reminderlist
  if (interaction.commandName === 'reminderlist') {
    const reminders = await Reminder.find({});
    if (!reminders.length) {
      await interaction.reply('Nessun reminder.');
      return;
    }

    const desc = reminders
      .map((r, i) => `${i + 1}. ${r.message} (${r.time})`)
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

    const reminders = await Reminder.find({});
    if (!reminders[index]) {
      await interaction.reply('Numero non valido.');
      return;
    }

    await Reminder.findByIdAndDelete(reminders[index]._id);
    await interaction.reply('❌ Reminder cancellato.');
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
      ephemeral: true,
    });
    return;
  }

  // /help
  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Help – Reminder Bot')
      .setColor(0x1f8fff)
      .setDescription(
        [
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
        ].join('\n')
      )
      .setFooter({
        text: 'Suggerimento: usa UTC come timezone se il bot gira su un server estero.',
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

// ====== DEFINIZIONE COMANDI ======
const commands = [
  new SlashCommandBuilder()
    .setName('settimezone')
    .setDescription('Imposta il fuso orario (solo salvato, per ora)')
    .addStringOption((o) =>
      o
        .setName('timezone')
        .setDescription('Es: Europe/Rome')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setreminder')
    .setDescription('Crea un promemoria')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Canale dove inviare il messaggio')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('time')
        .setDescription('Ora HH:MM (24h)')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('Testo del promemoria')
        .setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('times')
        .setDescription('Quante volte (lascia vuoto per infinito)')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('days')
        .setDescription('Giorni settimana 1-7, es: 1,3 per lunedì e mercoledì')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('reminderlist')
    .setDescription('Mostra tutti i reminder'),

  new SlashCommandBuilder()
    .setName('remindercanc')
    .setDescription('Cancella reminder per numero nella lista')
    .addIntegerOption((o) =>
      o
        .setName('numero')
        .setDescription('Numero dalla lista')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remindercancall')
    .setDescription('Cancella tutti i reminder salvati'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Mostra la lista dei comandi del bot'),
].map((cmd) => cmd.toJSON());

// ====== REGISTRA COMANDI E AVVIA BOT ======
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function start() {
  try {
    console.log('Registrazione comandi slash...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, SERVER_ID),
      { body: commands }
    );
    console.log('✅ Comandi registrati.');

    await client.login(TOKEN);
    console.log('✅ Bot online!');
  } catch (err) {
    console.error(err);
  }
}

start();
