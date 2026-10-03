import net from 'node:net';

export async function startSmtpSink() {
  const messages = [];
  const server = net.createServer((sock) => {
    let mode = 'cmd';
    let buf = '';
    let msg = { from: '', to: [], data: '' };
    const say = (line) => sock.write(line + '\r\n');
    say('220 sink ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (mode === 'data') {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          msg.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          messages.push(msg);
          msg = { from: '', to: [], data: '' };
          mode = 'cmd';
          say('250 queued');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') {
          sock.write('250-sink\r\n250 8BITMIME\r\n');
        } else if (cmd === 'MAIL') {
          msg.from = (/<([^>]*)>/.exec(line) || [])[1] || '';
          say('250 ok');
        } else if (cmd === 'RCPT') {
          msg.to.push(((/<([^>]*)>/.exec(line) || [])[1] || '').toLowerCase());
          say('250 ok');
        } else if (cmd === 'DATA') {
          mode = 'data';
          say('354 go ahead');
        } else if (cmd === 'QUIT') {
          say('221 bye');
          sock.end();
          return;
        } else {
          say('250 ok');
        }
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    messages,
    clear: () => messages.splice(0, messages.length),
    to: (address) => messages.filter((m) => m.to.includes(address.toLowerCase())),
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

export function htmlPart(raw) {
  const m = /Content-Type: text\/html[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--/i.exec(raw)
    || /Content-Transfer-Encoding: quoted-printable\r\nContent-Type: text\/html[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--/i.exec(raw);
  if (!m) return '';
  return m[1].replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
