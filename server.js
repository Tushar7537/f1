const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize Clarifai
const Clarifai = require('clarifai');
const clarifaiApp = new Clarifai.App({
  apiKey: process.env.CLARIFAI_API_KEY || 'a98fefbd39c7432b9a6b59b4cd68c1a4'
});

// API Routes
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageBuffer = req.file.buffer;
    const imageBase64 = imageBuffer.toString('base64');

    let result;
    let apiUsed = 'Clarifai';

    try {
      // Try Clarifai first
      result = await analyzeWithClarifai(imageBase64);
    } catch (clarifaiError) {
      console.log('Clarifai failed:', clarifaiError);
      // For now, we'll simulate Google Vision since credentials are needed
      result = simulateGoogleVisionAnalysis();
      apiUsed = 'Google Vision (Simulated)';
    }

    res.json({
      success: true,
      apiUsed: apiUsed,
      ...result
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Clarifai Analysis Function
async function analyzeWithClarifai(imageBase64) {
  try {
    const response = await clarifaiApp.models.predict(
      Clarifai.FOOD_MODEL,
      { base64: imageBase64 }
    );

    const concepts = response.outputs[0].data.concepts;
    const foodItems = concepts.slice(0, 5).map(item => ({
      name: item.name,
      confidence: item.value
    }));

    // Get the primary food item (highest confidence)
    const primaryFood = foodItems[0];
    
    // Generate nutrition data based on food type
    const nutritionData = generateNutritionData(primaryFood.name);
    
    return {
      foodName: primaryFood.name,
      confidence: primaryFood.confidence,
      alternatives: foodItems.slice(1),
      nutrition: nutritionData
    };
  } catch (error) {
    console.error('Clarifai API error:', error);
    throw new Error('Clarifai analysis failed');
  }
}

// Simulated Google Vision Analysis
function simulateGoogleVisionAnalysis() {
  // This is a simulation - real implementation would use the Vision API
  const foodNames = ['Pizza', 'Burger', 'Salad', 'Pasta', 'Sandwich', 'Apple', 'Banana', 'Chicken', 'Steak', 'Soup'];
  const randomFood = foodNames[Math.floor(Math.random() * foodNames.length)];
  
  return {
    foodName: randomFood,
    confidence: 0.85,
    alternatives: [],
    nutrition: generateNutritionData(randomFood)
  };
}

// Generate nutrition data based on food type
function generateNutritionData(foodName) {
  const nutritionTemplates = {
    pizza: { calories: 285, protein: 12, carbs: 36, fat: 10, fiber: 2, sugar: 5, sodium: 640, cholesterol: 18 },
    burger: { calories: 354, protein: 20, carbs: 29, fat: 18, fiber: 2, sugar: 6, sodium: 520, cholesterol: 65 },
    salad: { calories: 85, protein: 5, carbs: 10, fat: 3, fiber: 4, sugar: 4, sodium: 120, cholesterol: 0 },
    pasta: { calories: 220, protein: 8, carbs: 43, fat: 2, fiber: 3, sugar: 3, sodium: 280, cholesterol: 0 },
    sandwich: { calories: 320, protein: 15, carbs: 40, fat: 12, fiber: 3, sugar: 5, sodium: 810, cholesterol: 35 },
    apple: { calories: 95, protein: 0.5, carbs: 25, fat: 0.3, fiber: 4, sugar: 19, sodium: 2, cholesterol: 0 },
    banana: { calories: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3, sugar: 14, sodium: 1, cholesterol: 0 },
    chicken: { calories: 335, protein: 25, carbs: 0, fat: 25, fiber: 0, sugar: 0, sodium: 120, cholesterol: 85 },
    steak: { calories: 679, protein: 62, carbs: 0, fat: 48, fiber: 0, sugar: 0, sodium: 175, cholesterol: 225 },
    soup: { calories: 120, protein: 5, carbs: 15, fat: 4, fiber: 2, sugar: 3, sodium: 980, cholesterol: 10 }
  };

  const defaultNutrition = { calories: 250, protein: 10, carbs: 30, fat: 8, fiber: 2, sugar: 4, sodium: 400, cholesterol: 25 };
  
  const key = foodName.toLowerCase();
  return nutritionTemplates[key] || defaultNutrition;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});