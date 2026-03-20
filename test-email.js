const { Q } = require('./db/database');
const QRCode = require('qrcode');

async function test() {
  // Check RSVPs with emails
  const rsvpsWithEmails = Q.rsvpWithEmails();
  console.log('RSVPs with emails:', rsvpsWithEmails.length);

  rsvpsWithEmails.forEach(r => {
    console.log('---');
    console.log('Name:', r.name);
    console.log('Email:', r.email);
    console.log('Barcode:', r.barcode);
    console.log('Barcode Sent:', r.barcode_sent);
  });

  // Test QR code generation for a sample barcode
  if (rsvpsWithEmails.length > 0 && rsvpsWithEmails[0].barcode) {
    const testBarcode = rsvpsWithEmails[0].barcode;
    console.log('\n=== Testing QR code generation for:', testBarcode, '===');
    
    try {
      const buffer = await QRCode.toBuffer(testBarcode, {
        type: 'png',
        width: 300,
        margin: 2,
        color: { dark: '#0C1A0E', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });
      console.log('Buffer length:', buffer.length);
      console.log('Valid PNG:', buffer[0] === 0x89 && buffer[1] === 0x50);
    } catch (e) {
      console.error('Error generating QR:', e);
    }
  }
}

test().catch(console.error);
