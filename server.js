const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;  // WAJIB pakai process.env.PORT!

app.get('/', (req, res) => {
  res.send('Backend berjalan!');
});

app.listen(PORT, '0.0.0.0', () => {      // WAJIB listen ke 0.0.0.0!
  console.log(`Server running on port ${PORT}`);
});