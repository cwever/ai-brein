import express from 'express';
import pg from 'pg';
import 'dotenv/config';

const app = express();
app.use(express.json());

// Verbinden met jouw Supabase Pooler-link uit de .env
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

app.post('/api/chat', async (req, res) => {
    const { saasUserId, sessionId, userMessage } = req.body;
    
    try {
        // A. Sessie controleren of aanmaken
        let currentSessionId = sessionId;
        if (!currentSessionId) {
            const sessionRes = await pool.query(
                'INSERT INTO ai_sessions (saas_user_id) VALUES ($1) RETURNING id', 
                [saasUserId]
            );
            currentSessionId = sessionRes.rows[0].id;
        }

        // B. Bericht van de gebruiker opslaan in Supabase
        await pool.query(
            'INSERT INTO ai_messages (session_id, role, content) VALUES ($1, $2, $3)', 
            [currentSessionId, 'user', userMessage]
        );

        // C. Laatste 10 berichten ophalen uit Supabase voor de AI-context
        const historyRes = await pool.query(
            'SELECT role, content FROM ai_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 10', 
            [currentSessionId]
        );
        const chatMessagesForLLM = historyRes.rows.map(row => ({ 
            role: row.role, 
            content: row.content 
        }));

        // D. De exacte Fetch-aanroep naar OpenRouter (Zonder SDK nukken!)
        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000', 
                'X-Title': 'Mijn AI SaaS Brein'
            },
            body: JSON.stringify({
                model: 'openrouter/free', // Gebruik de gratis modellen-carrousel
                messages: [
                    { role: 'system', content: 'Je bent een behulpzame AI-assistent met toegang tot een centraal database-geheugen.' },
                    ...chatMessagesForLLM
                ]
            })
        });

        const data = await openRouterResponse.json();

        // Extra controle: als OpenRouter een fout geeft, loggen we die direct
        if (data.error) {
            throw new Error(`OpenRouter Error: ${data.error.message || JSON.stringify(data.error)}`);
        }

        const aiAnswer = data.choices[0].message.content;

        // E. Het antwoord van de AI opslaan in Supabase
        await pool.query(
            'INSERT INTO ai_messages (session_id, role, content) VALUES ($1, $2, $3)', 
            [currentSessionId, 'assistant', aiAnswer]
        );

        // F. Stuur het antwoord terug naar jouw test-terminal of frontend
        res.json({ sessionId: currentSessionId, answer: aiAnswer });

    } catch (error) {
        console.error("❌ SERVER FOUT:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log('AI Server draait stabiel op poort 3000'));
