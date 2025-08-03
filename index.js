const fs = require('fs');
const axios = require('axios');
const bip39 = require('bip39');
const edHd = require('ed25519-hd-key');

const StellarSdk = require('stellar-sdk');
// Ganti dengan info Telegram kamu
const TELEGRAM_BOT_TOKEN = 'TOKEN_BOT';
const TELEGRAM_CHAT_ID = 'ID_TELEGRAM';

// StellarSdk.Server
const server = new StellarSdk.Server('https://apimainnet.vercel.app');

// <<< BARU: Fungsi untuk memberi jeda (dalam milidetik)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Kirim pesan ke Telegram
async function kirimTelegram(pesan) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: pesan,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('❌ Gagal kirim ke Telegram:', error.message);
    // Jika gagal karena rate limit, kita bisa menunggu lebih lama
    if (error.response && error.response.status === 429) {
      console.log('Terkena rate limit Telegram, menunggu 3 detik...');
      await delay(3000); // Tunggu 3 detik
    }
  }
}

// Ubah mnemonic ke keypair Stellar (path Pi Network)
function mnemonicToStellarKeypair(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = edHd.derivePath("m/44'/314159'/0'", seed);
  return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

// Ambil dan filter daftar mnemonic dari file
const mnemonics = fs.readFileSync('pharses.txt', 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && line.split(' ').length === 24);

// Kosongkan file hasil sebelumnya
fs.writeFileSync('valid.txt', '');
fs.writeFileSync('invalid.txt', '');

// Cek setiap mnemonic
async function cekSemua() {
  console.log(`Memulai pengecekan untuk ${mnemonics.length} mnemonic...`);
  for (const [index, mnemonic] of mnemonics.entries()) {
    try {
      const keypair = mnemonicToStellarKeypair(mnemonic);
      const pubkey = keypair.publicKey();

      // Coba load akun dari jaringan Pi
      await server.loadAccount(pubkey);

      // Jika berhasil (terdaftar)
      console.log(`[${index + 1}/${mnemonics.length}] ✅ Terdaftar: ${pubkey}`);
      fs.appendFileSync('valid.txt', `${mnemonic}\n`);

      const pesan = `✅ *Mnemonic Valid & Terdaftar*\n\n\`${mnemonic}\`\n\n*Public Key:*\n\`${pubkey}\``;
      await kirimTelegram(pesan);

    } catch (err) {
      if (err.response && err.response.status === 404) {
        const keypair = mnemonicToStellarKeypair(mnemonic);
        const pubkey = keypair.publicKey();
        console.log(`[${index + 1}/${mnemonics.length}] ❌ Tidak terdaftar: ${pubkey}`);
        fs.appendFileSync('invalid.txt', `${mnemonic}\n`);
      } else {
        console.error(`[${index + 1}/${mnemonics.length}] ⚠️ Error saat cek mnemonic: ${mnemonic}`);
        console.error(err.message || err);
      }
    }

    // <<< BARU: Beri jeda 2 detik setelah setiap pengecekan
    // Anda bisa mengubah angka 2000 (milidetik) sesuai kebutuhan.
    // 1000 = 1 detik.
    // Jeda ini akan mengurangi beban ke server Pi dan API Telegram.
    await delay(2000); 
  }
  console.log('Selesai. Semua mnemonic telah dicek.');
}

cekSemua();
