// =================================================================
// Skrip Pengecek Aset Akun Pi Network
// Versi: Final (dengan perbaikan metode .claimant())
// =================================================================

const fs = require('fs');
const axios = require('axios');
const bip39 = require('bip39');
const edHd = require('ed25519-hd-key');
const StellarSdk = require('stellar-sdk');

// --- PENGATURAN WAJIB ---
const TELEGRAM_BOT_TOKEN = 'ISI_DENGAN_TOKEN_BOT_ANDA'; // isi token bot telegram anda
const TELEGRAM_CHAT_ID = 'ISI_DENGAN_CHAT_ID_ANDA'; // isi id telegram anda
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

      // <<< INI BAGIAN YANG DIPERBAIKI >>>
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
            const tanggalUnlockFormatted = new Date(unlockDate).toLocaleString('id-ID', {
              timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            pesanLockup += ` - *${amount.toFixed(2)} Pi* (Buka Kunci: ${tanggalUnlockFormatted} UTC)\n`;
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
