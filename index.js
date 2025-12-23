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

    // Profile 
    app.get("/users/profile/:email", async (req, res) => {
      const result = await userCollections.findOne({ email: req.params.email });
      res.send(result || {});
    });

    // Profile update
    app.patch("/users/profile/:email", verifyFBToken, async (req, res) => {
      const result = await userCollections.updateOne(
        { email: req.params.email },
        { $set: req.body }
      );
      res.send(result);
    });

    // search user

    app.get("/users/search", async (req, res) => {
      const { blood, district, upazila } = req.query;
      const query = { role: "donor", status: "active" };

      if (blood) query.blood = blood;
      if (district) query.district = district;
      if (upazila) query.upazila = upazila;

      const result = await userCollections.find(query).toArray();

      res.send(result);
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
      const result = await requestsCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .sort({ createdAt: -1 })
        .toArray();

      const totalReqest = await requestsCollection.countDocuments(query);

      res.send({ request: result, totalReqest });
    });


    // All requests with filter + pagination funsonality
    app.get("/requests/all", verifyFBToken, async (req, res) => {
      const status = req.query.status || "all";
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const query = status !== "all" ? { donation_status: status } : {};

      try {
        const requests = await requestsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        const total = await requestsCollection.countDocuments(query);

        res.send({ requests, total });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // 2. Update status (Admin + Volunteer)
    app.patch("/requests/:id/status", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!["pending", "inprogress", "done", "canceled"].includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      try {
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { donation_status: status } }
        );
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // edit donation request 
    app.patch("/requests/:id", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const user = await userCollections.findOne({ email });
      let query = { _id: new ObjectId(req.params.id) };

      if (user?.role !== "admin") {
        query.requester_email = email;
      }

      const result = await requestsCollection.updateOne(
        query,
        { $set: req.body }
      );
      res.send(result);
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

    // admin dashboard 
    app.get("/admin-stats", verifyFBToken, async (req, res) => {
      const users = await userCollections.countDocuments();
      const requests = await requestsCollection.countDocuments();
      const funding = await paymentCollection.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]).toArray();
      res.send({ users, requests, funding: funding[0]?.total || 0 });
    });

    // role set
    app.patch("/update/user/role", verifyFBToken, async (req, res) => {
      const { email, role } = req.query;
      const result = await userCollections.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(result);
    });

    // payment

    app.post('/create-payment-checkout', async (req, res) => {
      const information = req.body;
      const amount = parseInt(information.donateAmount) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: 'please donate'
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          donorName: information?.donorName
        },
        customer_email: information?.donorEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`
      });

      res.send({ url: session.url })
    })

    // success payment
    app.post('/success-payment', async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(
        session_id
      );
      console.log(session)

      const transactionId = session.payment_intent;

      const isPaymentExist = await paymentCollection.findOne({ transactionId })

      if (isPaymentExist) {
        return
      }

      if (session.payment_status == 'paid') {
        const paymentInfo = {
          amount: session.amount_total / 100,
          currency: session.currency,
          donorEmail: session.customer_email,
          transactionId,
          payment_status: session.payment_status,
          paidAt: new Date()
        }
        const result = await paymentCollection.insertOne(paymentInfo)
        return res.send(result)
      }
    })
    // funding history 
    app.get("/payments/history", async (req, res) => {
      const result = await paymentCollection.find().sort({ paidAt: -1 }).toArray();
      res.send(result);
    });

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