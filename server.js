const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
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
  limits: { fileSize: 10 * 1024 * 1024 }
});

// API Keys
const CLARIFAI_API_KEY = 'a98fefbd39c7432b9a6b59b4cd68c1a4';
const GOOGLE_VISION_API_KEY = 'AIzaSyB0UysNkk35gH3ijJCgh-89ETk-30wBMZ0';
const USDA_API_KEY = 'ArnraqbFs53M8MEMU0jmS6dM5XgGW2fJtPNeYRic';

// Initialize Clarifai
const Clarifai = require('clarifai');
const clarifaiApp = new Clarifai.App({
  apiKey: CLARIFAI_API_KEY
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
      // Try Clarifai first (Tier 1)
      result = await analyzeWithClarifai(imageBase64);
    } catch (clarifaiError) {
      console.log('Clarifai failed, trying Google Vision:', clarifaiError);
      apiUsed = 'Google Vision';
      
      try {
        // Try Google Vision second (Tier 2)
        result = await analyzeWithGoogleVision(imageBase64);
      } catch (visionError) {
        console.log('Google Vision failed, trying USDA:', visionError);
        apiUsed = 'USDA';
        
        try {
          // Try USDA third (Tier 3)
          // For USDA, we need food name first, so we'll use a fallback
          const foodName = await getFoodNameFromImage(imageBase64);
          result = await analyzeWithUSDA(foodName);
        } catch (usdaError) {
          console.error('All APIs failed:', usdaError);
          return res.status(500).json({ 
            error: 'Food analysis failed. Please try another image.' 
          });
        }
      }
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

// Helper function to get food name when USDA needs it
async function getFoodNameFromImage(imageBase64) {
  try {
    // Try Clarifai first for food name
    const response = await clarifaiApp.models.predict(
      Clarifai.FOOD_MODEL,
      { base64: imageBase64 }
    );
    
    const concepts = response.outputs[0].data.concepts;
    return concepts[0].name; // Return the top food item
  } catch (error) {
    // Fallback to a generic food name
    return 'apple'; // Default fallback
  }
}

// Clarifai Analysis Function (Tier 1)
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

    const primaryFood = foodItems[0];
    
    // Try to get detailed nutrition from USDA
    let nutritionData;
    try {
      nutritionData = await analyzeWithUSDA(primaryFood.name);
    } catch (usdaError) {
      console.log('USDA failed, using generated data:', usdaError);
      nutritionData = generateNutritionData(primaryFood.name);
    }
    
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

// Google Vision Analysis Function (Tier 2)
async function analyzeWithGoogleVision(imageBase64) {
  try {
    const requestData = {
      requests: [
        {
          image: {
            content: imageBase64
          },
          features: [
            {
              type: 'LABEL_DETECTION',
              maxResults: 10
            }
          ]
        }
      ]
    };

    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const labels = response.data.responses[0].labelAnnotations;
    const foodLabels = labels
      .filter(label => label.score > 0.7)
      .slice(0, 5)
      .map(label => ({
        name: label.description,
        confidence: label.score
      }));

    if (foodLabels.length === 0) {
      throw new Error('No food items detected');
    }

    const primaryFood = foodLabels[0];
    
    // Try to get detailed nutrition from USDA
    let nutritionData;
    try {
      nutritionData = await analyzeWithUSDA(primaryFood.name);
    } catch (usdaError) {
      console.log('USDA failed, using generated data:', usdaError);
      nutritionData = generateNutritionData(primaryFood.name);
    }
    
    return {
      foodName: primaryFood.name,
      confidence: primaryFood.confidence,
      alternatives: foodLabels.slice(1),
      nutrition: nutritionData
    };
  } catch (error) {
    console.error('Google Vision API error:', error);
    throw new Error('Google Vision analysis failed');
  }
}

// USDA Analysis Function (Tier 3)
async function analyzeWithUSDA(foodName) {
  try {
    // Search for food in USDA database
    const searchResponse = await axios.get(
      `https://api.nal.usda.gov/fdc/v1/foods/search`,
      {
        params: {
          api_key: USDA_API_KEY,
          query: foodName,
          pageSize: 1
        }
      }
    );

    if (!searchResponse.data.foods || searchResponse.data.foods.length === 0) {
      throw new Error('Food not found in USDA database');
    }

    const foodData = searchResponse.data.foods[0];
    
    // Extract nutrition information
    const nutrients = {};
    foodData.foodNutrients.forEach(nutrient => {
      nutrients[nutrient.nutrientName] = nutrient.value;
    });

    return {
      calories: nutrients.Energy || 0,
      protein: nutrients.Protein || 0,
      carbs: nutrients['Carbohydrate, by difference'] || 0,
      fat: nutrients['Total lipid (fat)'] || 0,
      fiber: nutrients['Fiber, total dietary'] || 0,
      sugar: nutrients['Sugars, total including NLEA'] || 0,
      sodium: nutrients['Sodium, Na'] || 0,
      cholesterol: nutrients.Cholesterol || 0
    };
  } catch (error) {
    console.error('USDA API error:', error);
    throw new Error('USDA analysis failed');
  }
}

// Fallback nutrition data generator
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
    soup: { calories: 120, protein: 5, carbs: 15, fat: 4, fiber: 2, sugar: 3, sodium: 980, cholesterol: 10 },
    rice: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0.1, sodium: 1, cholesterol: 0 },
    bread: { calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, sugar: 5, sodium: 491, cholesterol: 0 },
    egg: { calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1, sodium: 124, cholesterol: 373 },
    milk: { calories: 61, protein: 3.3, carbs: 4.8, fat: 3.3, fiber: 0, sugar: 5.1, sodium: 40, cholesterol: 10 },
    cheese: { calories: 404, protein: 25, carbs: 1.3, fat: 33, fiber: 0, sugar: 0.5, sodium: 621, cholesterol: 105 }
  };

  const defaultNutrition = { calories: 250, protein: 10, carbs: 30, fat: 8, fiber: 2, sugar: 4, sodium: 400, cholesterol: 25 };
  
  const key = foodName.toLowerCase();
  return nutritionTemplates[key] || defaultNutrition;
}

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('APIs configured:');
  console.log('- Clarifai: Ready');
  console.log('- Google Vision: Ready');
  console.log('- USDA: Ready');
});
