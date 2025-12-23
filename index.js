const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.STRIPE_SECRATE);
const crypto = require('crypto')

app.use(cors());
app.use(express.json());


const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// jwt middleware

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('decoded in the token', decoded);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

}

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@aplication1.govvz0x.mongodb.net/?appName=aplication1`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    // database & collection
    const database = client.db('blood-Donation')
    const userCollections = database.collection('users')
    const requestsCollection = database.collection("requests");
    const paymentCollection = database.collection("payments");

    // create user 
    app.post('/users', async (req, res) => {
      const userInfo = req.body;

      userInfo.role = "donor";
      userInfo.createdAt = new Date();
      const result = await userCollections.insertOne(userInfo);
      res.send(result)
    })

    // user role
    app.get('/users/role/:email', async (req, res) => {
      const { email } = req.params
      const query = { email: email }
      const result = await userCollections.findOne(query)
      res.send(result)
    })

    // all user info
    app.get("/users", verifyFBToken, async (req, res) => {
      const result = await userCollections.find().toArray();
      res.status(200).send(result);
    });

    // donation request 
    app.post("/requests", verifyFBToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestsCollection.insertOne(data);
      res.send(result);
    });

    // my request
    app.get("/my-request", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const size = Number(req.query.size) || 10;
      const page = Number(req.query.page) || 0;
      const status = req.query.status;

      const query = { requester_email: email };
      if (status && status !== "all") {
        query.donation_status = status;
      }

      // edit donation request 
      app.patch("/requests/:id", verifyFBToken, async (req, res) => {
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(req.params.id), requester_email: req.decoded_email },
          { $set: req.body }
        );
        res.send(result);
      });

      const result = await requestsCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .sort({ createdAt: -1 })
        .toArray();

      const totalReqest = await requestsCollection.countDocuments(query);

      res.send({ request: result, totalReqest });
    });

    // user block and active
    app.patch("/update/user/status", verifyFBToken, async (req, res) => {
      const { email, status } = req.query;
      const query = { email: email };
      const updateStatus = {
        $set: { status: status },
      };
      const result = await userCollections.updateOne(query, updateStatus);
      res.send(result);
    });

    // public blood donation page
    app.get("/requests/pending", async (req, res) => {
      const result = await requestsCollection
        .find({ donation_status: "pending" })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // request details page 
    app.get("/requests/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await requestsCollection.findOne({ _id: new ObjectId(id) });
        if (!result) {
          return res.status(404).send({ message: "Request not found" });
        }
        res.send(result);
      } catch (error) {
        console.error("Error fetching request:", error);
        res.status(500).send({ message: "Invalid ID or server error" });
      }
    });

    // donations status update 
    app.patch("/requests/:id/donate", verifyFBToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { donorName, donorEmail } = req.body;

        const result = await requestsCollection.updateOne(
          {
            _id: new ObjectId(id),
            donation_status: "pending"
          },
          {
            $set: {
              donation_status: "inprogress",
              donorName,
              donorEmail,
              donatedAt: new Date()
            }
          }
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Delete
    app.delete("/requests/:id", verifyFBToken, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await requestsCollection.deleteOne({
          _id: new ObjectId(id),
          requester_email: req.decoded_email
        });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });





    // payment



    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Blood Donation Server is Running!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});