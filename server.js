'use strict';

const { pb, initPocketBase } = require('./pocketbase');

const express = require('express');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json());

(async () => {
    await initPocketBase();
    // existing startup logic
})();

// Example API routes with PocketBase
app.get('/example/:id', async (req, res) => {
    try {
        const data = await pb.collection('example').getOne(req.params.id);
        res.json(data);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/example', async (req, res) => {
    try {
        const newData = await pb.collection('example').create(req.body);
        res.status(201).json(newData);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Update and other routes...

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});