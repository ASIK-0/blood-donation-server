const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Blood Donation Server is Running!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});