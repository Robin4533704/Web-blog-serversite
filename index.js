// index.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import fs from "fs";
import admin from "firebase-admin";
import axios from "axios";
import FormData from "form-data";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const app = express();

// Middleware
app.use(cors({
 origin: 'http://localhost:5173', // আপনার frontend URL
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Debugging middleware - CORS এর পরে
app.use((req, res, next) => {
  console.log("====== INCOMING REQUEST ======");
  console.log("🌐 URL:", req.url);
  console.log("📝 Method:", req.method);
  console.log("🔑 Authorization:", req.headers.authorization);
  console.log("📦 Body:", req.body);
  console.log("==============================");
  next();
});


// ES module path fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSON read
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./firebase-web-blog.json"), "utf-8")
);

// Firebase init
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "web-blogs-app.appspot.com"
});

// MongoDB
let mongoClient;
let dbInstance; 
async function connectDB() {
  if (!dbInstance) {
    mongoClient = new MongoClient(
      `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvaruep.mongodb.net/?retryWrites=true&w=majority`
    );
    await mongoClient.connect();
    dbInstance = mongoClient.db(process.env.DB_NAME || "blogWebsite"); // ✅ DB instance set করা
    console.log("✅ MongoDB connected");
  }
  return dbInstance; // ✅ এখন DB instance return করবে
}

async function getCollections() {
  const db = await connectDB(); // এখানে DB instance already আছে
  return {
    blogsCollection: db.collection("blogs"),
    usersCollection: db.collection("users"),
    subscribersCollection: db.collection("subscribers"),
    contactsCollection: db.collection("contacts"),
    activitiesCollection: db.collection("activities"), 
  };
}


// Activity Logger
async function logActivity({ user, type, message, blogId = null }) {
  const { activitiesCollection } = await getCollections();
  const activity = {
    user: {
      uid: user?.uid || "guest",
      email: user?.email || "unknown",
    },
    type,
    message,
    blogId,
    timestamp: new Date(),
  };
  await activitiesCollection.insertOne(activity);
  console.log("🟢 Activity Logged:", message);
}

const verifyFirebaseToken = async (req, res, next) => {
  console.log("🧾 Incoming headers:", req.headers); // check Authorization
  const authHeader = req.headers.authorization;

  try {
    if (!authHeader) {
      // ✅ Development mode: skip verification if no token
      if (process.env.NODE_ENV !== "production") {
        console.warn("⚠️ No token provided, skipping verification in dev mode");
        req.user = { uid: "devUser", name: "Development User" };
        return next();
      }
      // Production mode: reject
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};



// Example protected route
app.get("/users", verifyFirebaseToken, async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const users = await usersCollection.find().toArray();
    res.json({ success: true, data: users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/", (req, res) => res.send("🚀 Blog API running"));

app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL, role } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email required" });
    }

    const { usersCollection } = await getCollections();
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = {
      uid: null,
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

app.get("/users/role", verifyFirebaseToken, async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const { usersCollection } = await getCollections();
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.json({ role: "user" });
    }

    res.json({ role: user.role || "user" });
  } catch (error) {
    console.error("Error fetching role:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const { usersCollection } = await getCollections();

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

// Blogs
app.get("/blogs", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const allBlogs = await blogsCollection.find({}).toArray();
    res.json(allBlogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Add blog
app.post("/blogs", verifyFirebaseToken, async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const blogData = req.body;
    const user = req.user; // verifyFirebaseToken থেকে আসা logged-in user

    // Blog insert
    const result = await blogsCollection.insertOne({
      ...blogData,
      author: {
        uid: user.uid,
        email: user.email,
      },
      createdAt: new Date(),
    });

    // Log activity
    await logActivity({
      user,
      type: "CREATE",
      message: `${user.email} created a new blog`,
      blogId: result.insertedId,
    });

    res.status(201).json({ message: "Blog added", blogId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add blog", error: err.message });
  }
});

// Example route: Create Blog
app.post("/blogs", async (req, res) => {
  try {
    const db = await connectDB();
    const blogsCollection = db.collection("blogs");

    const { title, content, author } = req.body;

    const newBlog = {
      title,
      content,
      author,
      createdAt: new Date(),
    };

    const result = await blogsCollection.insertOne(newBlog);

    // ✅ Log activity
    await logActivity({
      user: author,
      type: "CREATE",
      message: `${author?.email || "Someone"} created a new blog "${title}"`,
      blogId: result.insertedId,
    });

    res.status(201).json({ success: true, blog: newBlog });
  } catch (err) {
    console.error("Error creating blog:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.get("/activities", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid; // Firebase token থেকে uid
    const db = await connectDB();
    const activitiesCollection = db.collection("activities");

    const activities = await activitiesCollection
      .find({ "user.uid": uid }) // শুধু এই user এর activities
      .sort({ timestamp: -1 })
      .toArray();

    res.json(activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch activities" });
  }
});
app.get("/blogs/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid blog ID" });

  try {
    const { blogsCollection } = await getCollections();
    const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    res.json({ success: true, blog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});
app.put("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const { id } = req.params;
    const updateData = req.body;

    const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    if (blog.author?.email !== req.user.email)
      return res.status(403).json({ message: "Forbidden: You can edit only your own blog" });

    await blogsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { ...updateData } });
    res.json({ message: "Blog updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Delete blog route
app.delete("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const { id } = req.params;

    // যদি id invalid হয় তাহলে handle করা
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid blog ID" });
    }

    const result = await blogsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Blog not found" });
    }

    res.json({ message: "Blog deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

app.get("/blogs/user/:email", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const email = decodeURIComponent(req.params.email);
    const blogs = await blogsCollection.find({ "author.email": email }).toArray();
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
    const blogId = req.params.id;
    const review = req.body;
    const { blogsCollection } = await getCollections();

    if (!ObjectId.isValid(blogId))
      return res.status(400).json({ success: false, message: "Invalid blog ID" });

    await blogsCollection.updateOne({ _id: new ObjectId(blogId) }, { $push: { reviews: review } });
    res.json({ success: true, message: "Review added successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/reviews", async (req, res) => {
  try {
    const { blogsCollection } = await getCollections();
    const allBlogs = await blogsCollection.find({}).toArray();

    const allReviews = allBlogs.flatMap(blog =>
      (blog.reviews || []).map(review => ({
        userName: review.userName || "Guest",
        userImage: review.userImage || "https://i.ibb.co/MBtjqXQ/default-avatar.png",
        comment: review.comment || "",
        rating: review.rating || 0,
        date: review.date || new Date(),
        blogId: blog._id,
        blogTitle: blog.title
      }))
    );

    res.json(allReviews);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// DELETE /reviews/:blogId/:commentId
app.delete("/:blogId/:commentId", async (req, res) => {
  const { blogId, commentId } = req.params;

  try {
    const { blogsCollection } = await getCollections();

    const blog = await blogsCollection.findOne({ _id: new ObjectId(blogId) });
    if (!blog) return res.status(404).json({ message: "Blog not found" });

    const originalLength = (blog.reviews || []).length;

    // filter out the review to delete
    const updatedReviews = (blog.reviews || []).filter(
      (r) => r._id.toString() !== commentId
    );

    if (updatedReviews.length === originalLength)
      return res.status(404).json({ message: "Review not found" });

    // update the blog document
    await blogsCollection.updateOne(
      { _id: new ObjectId(blogId) },
      { $set: { reviews: updatedReviews } }
    );

    res.status(200).json({ success: true, message: "Review deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Upload image
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

// Stats
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
  try {
    const { id } = req.params;
    const { role } = req.body;
    const { usersCollection } = await getCollections();

    const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });
    if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });

    const updatedUser = await usersCollection.findOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: "User role updated", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Contacts
app.post("/contacts", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ message: "All fields are required" });

    const { contactsCollection } = await getCollections();
    await contactsCollection.insertOne({ name, email, message, createdAt: new Date() });
    res.status(201).json({ message: "Message received!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// index.js or routes/contacts.js
app.get("/contacts", verifyFirebaseToken, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(400).json({ message: "Email missing from token" });

    const { usersCollection, contactsCollection } = await getCollections();
    const user = await usersCollection.findOne({ email: userEmail });

    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied: Admins only" });
    }

    const contacts = await contactsCollection.find().toArray();
    res.json(contacts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


app.delete("/contacts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { contactsCollection } = await getCollections();

    const result = await contactsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Message not found" });

    res.status(200).json({ message: "Message deleted successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.post("/subscribers", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const { subscribersCollection } = await getCollections();

    // Check if already subscribed
    const existing = await subscribersCollection.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already subscribed" });
    }

    // Insert into DB
    await subscribersCollection.insertOne({ email, createdAt: new Date() });

    // Success response
    res.status(201).json({ success: true, message: "Subscribed successfully" });
  } catch (err) {
    console.error("Subscription error:", err);
    res.status(500).json({ success: false, message: "Subscription failed" });
  }
});


app.get("/subscribers", verifyFirebaseToken, async (req, res) => {
  try {
    const { subscribersCollection, usersCollection } = await getCollections();
    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied: Admins only" });
    }

    const subscribers = await subscribersCollection.find().toArray();
    res.json(subscribers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch subscribers" });
  }
});


// DELETE subscriber


app.delete("/subscribers/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { subscribersCollection, usersCollection } = await getCollections();

    // Admin check
    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied: Admins only" });
    }

    const result = await subscribersCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Subscriber not found" });
    }

    res.json({ success: true, message: "Subscriber deleted successfully" });
  } catch (err) {
    console.error("Delete subscriber error:", err);
    res.status(500).json({ success: false, message: "Failed to delete subscriber" });
  }
});




// Server start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
