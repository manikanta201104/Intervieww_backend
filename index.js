const express=require('express');
const cors=require('cors');
const fetch=require('node-fetch');

const app=express();
app.use(cors());
app.use(express.json());

const HF_API_URL='https://api-inference.huggingface.co/models/';
const YOUR_HF_API_KEY=process.env.HF_API_KEY;

app.post('/api/ask',async(req,res)=>{
    const{question,model='meta-llama/Llama-2-7b-chat-hf',promptTemplate}=req.body;
    if(!question) return res.status(400).json({error:'Question iis required'});

    const prompt=promptTemplate?promptTemplate.replace('{question}',question):`Answer the follwoing interview question very concisely:\n${question}`;

    try{
        const response=await fetch(HF_API_URL+model,{
            method:'POST',
            headers:{
                Authorization:`Bearer ${YOUR_HF_API_KEY}`,
                'Content-Type':'application/json',
            },
            body:JSON.stringify({inputs:prompt}),
        });
        if(!response.ok){
            const errorText=await response.text();
            return res.status(response.status).json({error:errorText});
        }

        const data=await response.json();
        const answerText=Array.isArray(data)?data[0]?.generated_text||JSON.stringify(data):data.generated_text||data.answer||JSON.stringify(data);
        res.json({answer:answerText});
    }catch(error){
        res.status(500).json({error:error.message});
    }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=> console.log(`AI Proxy server running on port ${PORT}`));