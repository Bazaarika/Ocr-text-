// server.js
const express = require('express');
const cors = require('cors'); // CORS के लिए
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config(); // .env फ़ाइल से variables लोड करने के लिए

const app = express();

// CORS सक्षम करें ताकि आपका फ्रंटएंड बैकएंड से बात कर सके
app.use(cors()); 

// JSON data को parse करने के लिए
app.use(express.json()); 

// अपनी static files (जैसे index.html) को serve करने के लिए
app.use(express.static('public'));

// API Key को environment variable से प्राप्त करें
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// API endpoint जो AI से सवाल पूछेगा
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

// Render dynamic port को हैंडल करने के लिए
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
