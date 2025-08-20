// server.js
const express = require('express');
const cors = require('cors');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();

app.use(cors()); 
app.use(express.json()); 
app.use(express.static('public'));

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.post('/ask-ai', async (req, res) => {
    const userPrompt = req.body.prompt;
    if (!userPrompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: userPrompt }],
        });
        const answer = completion.data.choices[0].message.content;
        res.json({ answer: answer });
    } catch (error) {
        console.error("OpenAI API call failed:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI.' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
