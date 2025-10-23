import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import fs from "fs";
import admin from "firebase-admin";
import axios from "axios";
import FormData from "form-data";

dotenv.config();

const app = express();

// ✅ Middleware setup
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174"], // তোমার React dev URLs
  credentials: true
}));

app.use(express.json());

// ✅ Load Firebase service account
const serviceAccount = JSON.parse(
  fs.readFileSync("./web-blogs-app-firebase-adminsdk-fbsvc-36cc320e1b.json", "utf8")
);

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ===== MongoDB Setup =====
let mongoClient;
async function connectDB() {
  if (!mongoClient) {
    mongoClient = new MongoClient(
      `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority`
    );
    await mongoClient.connect();
    console.log("✅ MongoDB connected");
  }
  return mongoClient;
}

async function getCollections() {
  const client = await connectDB();
  const db = client.db(process.env.DB_NAME || "blogWebsite");
  return {
    blogsCollection: db.collection("blogs"),
    usersCollection: db.collection("users"),
    subscribersCollection: db.collection("subscribers"),
    contactsCollection: db.collection("contacts"),
  };
}

// ✅ Verify Firebase Token Middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};

// Root
app.get("/", (req, res) => res.send("🚀 Blog API running"));

// ✅ Authenticated route
app.get("/users", verifyFirebaseToken, async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const users = await usersCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});


// Create user
app.post("/users", async (req, res) => {
  try {
    const { uid, name, email, photoURL, role } = req.body;
    const { usersCollection } = await getCollections();

    const existingUser = await usersCollection.findOne({ uid });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const newUser = {
      uid,
      displayName: name,
      email,
      photoURL: photoURL || "https://i.ibb.co/MBtjqXQ/default-avatar.png",
      role: role || "user",
      created_at: new Date(),
      last_log_in: new Date(),
    };

    await usersCollection.insertOne(newUser);
    res.status(201).json({ message: "User created", user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/users/role",  async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ message: "Email required" });

  try {
    const { usersCollection } = await getCollections();
    let user = await usersCollection.findOne({ email });

    if (!user) {
      const newUser = { email, role: "user", fullName: "Unknown" };
      await usersCollection.insertOne(newUser);
      user = newUser;
    }

    res.json({ role: user.role || "user" });
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});


app.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const result = await User.updateOne({ _id: id }, { $set: updateData });
    res.send(result);
  } catch (err) {
    console.error(err); // <- এটা দেখো
    res.status(500).send({ error: err.message });
  }
});


app.patch("/blogs/:id", async (req, res) => {
  const { id } = req.params;
  const { title, content, image, category } = req.body;

  try {
    const { blogsCollection } = await getCollections(); // ensure this returns your collection

    const result = await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { title, content, image, category } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Blog not found" });
    }

    const updatedBlog = await blogsCollection.findOne({ _id: new ObjectId(id) });

    res.status(200).json(updatedBlog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get all blogs
app.get("/blogs", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const blogs = await blogsCollection.find().toArray();
    res.json(blogs || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Get single blog
app.get("/blogs/:id", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const blog = await blogsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });
    res.json({ success: true, blog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// Add blog
app.post("/blogs", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const blogData = req.body;

    const result = await blogsCollection.insertOne({
      ...blogData,
      createdAt: new Date(),
    });

    res.status(201).json({ message: "Blog added", blogId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add blog", error: err.message });
  }
});

// Update blog
app.put("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const { id } = req.params;
    const updateData = req.body;

    const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    if (blog.author?.email !== req.user.email)
      return res.status(403).json({ message: "Forbidden: You can edit only your own blog" });

    await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updateData } }
    );

    res.json({ message: "Blog updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Delete blog
app.delete("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const { id } = req.params;

    const result = await blogsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Blog not found" });

    res.json({ message: "Blog deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// server.js / routes/blogs.js
app.get("/blogs/user/:email", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const email = decodeURIComponent(req.params.email);
    console.log("Fetching blogs for:", email);

    const blogs = await blogsCollection.find({ "author.email": email }).toArray();
    console.log("Blogs found:", blogs.length);

    res.json(blogs || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});


// Like blog
app.post("/blogs/:id/like", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const { blogsCollection } = await getCollections();
    const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    const likedUsers = blog.likedUsers || [];
    if (likedUsers.includes(userId)) return res.status(400).json({ message: "Already liked" });

    await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { likes: 1 }, $push: { likedUsers: userId } }
    );

    res.json({ likes: (blog.likes || 0) + 1, message: "Like added" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Add review
app.post("/blogs/:id/reviews", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const { id } = req.params;
    const { userId, userName, comment, date } = req.body;

    const result = await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $push: { reviews: { userId, userName, comment, date } } }
    );

    if (result.modifiedCount === 0) return res.status(404).json({ message: "Blog not found" });

    const updatedBlog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    res.json({ reviews: updatedBlog.reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Upload image via imgbb
app.post("/upload-image", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: "Image required" });

    const key = process.env.IMGBB_API_KEY;
    const form = new FormData();
    form.append("image", imageBase64.replace(/^data:image\/\w+;base64,/, ""));

    const imgbbRes = await axios.post(`https://api.imgbb.com/1/upload?key=${key}`, form, {
      headers: form.getHeaders(),
      timeout: 20000,
    });

    const imageUrl = imgbbRes.data?.data?.display_url || imgbbRes.data?.data?.url;
    res.json({ success: true, url: imageUrl });
  } catch (err) {
    console.error("Imgbb upload error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Upload failed", error: err.message });
  }
});

// Dashboard stats
app.get("/stats", verifyFirebaseToken, async (req, res) => {
  try {
    const { usersCollection, blogsCollection } = await getCollections();
    const totalUsers = await usersCollection.countDocuments();
    const totalBlogs = await blogsCollection.countDocuments();
    const mostLiked = await blogsCollection.find().sort({ likes: -1 }).limit(1).toArray();
    res.json({ totalUsers, totalBlogs, mostLiked: mostLiked[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Update user role
app.patch("/role/:id", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  try {
    const { usersCollection } = await getCollections(); // তোমার existing function

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedUser = await usersCollection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({ message: "User role updated", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});



// ===== Start Server =====
connectDB().then(() => {
  app.listen(process.env.PORT || 5000, () =>
    console.log("🚀 Server running on port", process.env.PORT || 5000)
  );
});
