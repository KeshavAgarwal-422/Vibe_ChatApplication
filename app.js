const dotenv = require("dotenv").config();
const express = require("express");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const Users = require("./models/Users");
const Conversations = require("./models/Conversations");
const Messages = require("./models/Messages");
const https = require("https");
const io = require("socket.io");

const PORT_BACKEND = process.env.PORT_BACKEND || 8000;
const PORT_SOCKET = process.env.PORT_SOCKET || 8900;

// const io = require("socket.io")(PORT_SOCKET, {
//   cors: {
//     origin: process.env.FRONTEND_URL,
//   },
// });

const server = https.createServer();

const socketServer = io(server, {
  origin: process.env.FRONTEND_URL,
});

server.listen(PORT_SOCKET, () => {
  console.log(`Socket server is running on ${PORT_SOCKET}`);
});

const app = express();
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
  })
);

let users = [];
socketServer.on("connection", (socket) => {
  console.log("User connected", socket.id);
  console.log("Socket running on port", PORT_SOCKET);
  socket.on("addUser", (userId) => {
    const isUserExist = users.find((user) => user.userId === userId);
    if (!isUserExist) {
      const user = { userId, socketId: socket.id };
      users.push(user);
      io.emit("getUsers", users);
    }
  });

  socket.on(
    "sendMessage",
    async ({ senderId, receiverId, message, conversationId }) => {
      const receiver = users.find((user) => user.userId === receiverId);
      const sender = users.find((user) => user.userId === senderId);
      const user = await Users.findById(senderId);
      console.log("sender :>> ", sender, receiver);
      965;
      if (receiver) {
        io.to(receiver.socketId)
          .to(sender.socketId)
          .emit("getMessage", {
            senderId,
            message,
            conversationId,
            receiverId,
            user: { id: user._id, fullName: user.fullName, email: user.email },
          });
      } else {
        io.to(sender.socketId).emit("getMessage", {
          senderId,
          message,
          conversationId,
          receiverId,
          user: { id: user._id, fullName: user.fullName, email: user.email },
        });
      }
    }
  );

  socket.on("disconnect", () => {
    users = users.filter((user) => user.socketId !== socket.id);
    io.emit("getUsers", users);
  });
});

app.get("/", (req, res) => {
  res.json("Welcome");
});

app.post("/api/register", async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res
        .status(401)
        .json({ message: "Please fill all required fields" });
    } else {
      const isAlreadyExist = await Users.findOne({ email });

      if (isAlreadyExist) {
        res.status(400).json({ message: "User already exists" });
      } else {
        const newUser = new Users({ fullName, email });

        bcryptjs.hash(password, 10, (err, hashedPassword) => {
          if (err) {
            next(err);
          }
          newUser.set("password", hashedPassword);
          newUser.save();

          res.status(200).json({ message: "User registered successfully" });
        });
      }
    }
  } catch (error) {
    console.log(error, "Error");
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Please fill all required fields" });
    } else {
      const user = await Users.findOne({ email });
      if (!user) {
        res
          .status(400)
          .json({ message: "User email or password is incorrect" });
      } else {
        const validateUser = await bcryptjs.compare(password, user.password);
        if (!validateUser) {
          res
            .status(400)
            .json({ message: "User email or password is incorrect" });
        } else {
          const payload = {
            userId: user._id,
            email: user.email,
          };
          const JWT_SECRET_KEY =
            process.env.JWT_SECRET_KEY || "THIS_IS_A_JWT_SECRET_KEY";

          jwt.sign(
            payload,
            JWT_SECRET_KEY,
            { expiresIn: 84600 },
            async (err, token) => {
              await Users.updateOne(
                { _id: user._id },
                {
                  $set: { token },
                }
              );
              user.save();
              return res.status(200).json({
                user: {
                  id: user._id,
                  email: user.email,
                  fullName: user.fullName,
                },
                token: token,
                message: "Login successfull",
              });
            }
          );
        }
      }
    }
  } catch (error) {
    console.log(error, "Error");
  }
});

app.post("/api/conversation", async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    const newCoversation = new Conversations({
      members: [senderId, receiverId],
    });
    await newCoversation.save();
    res.status(200).json({ message: "Conversation created successfully" });
  } catch (error) {
    console.log(error, "Error");
  }
});

app.get("/api/conversations/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const conversations = await Conversations.find({
      members: { $in: [userId] },
    });
    const conversationUserData = Promise.all(
      conversations.map(async (conversation) => {
        const receiverId = conversation.members.find(
          (member) => member !== userId
        );
        const user = await Users.findById(receiverId);
        return {
          user: {
            receiverId: user._id,
            email: user.email,
            fullName: user.fullName,
          },
          conversationId: conversation._id,
        };
      })
    );
    res.status(200).json(await conversationUserData);
  } catch (error) {
    console.log(error, "Error");
  }
});

app.post("/api/message", async (req, res) => {
  try {
    const { conversationId, senderId, message, receiverId = "" } = req.body;

    if (!senderId || !message)
      return res
        .status(400)
        .json({ message: "Please fill all required fields" });
    if (conversationId === "new" && receiverId) {
      const newCoversation = new Conversations({
        members: [senderId, receiverId],
      });
      await newCoversation.save();
      const newMessage = new Messages({
        conversationId: newCoversation._id,
        senderId,
        message,
      });
      await newMessage.save();
      return res.status(200).json({ message: "Message sent successfully" });
    } else if (!conversationId && !receiverId) {
      return res
        .status(400)
        .json({ message: "Please fill all required fields" });
    }
    const newMessage = new Messages({ conversationId, senderId, message });
    await newMessage.save();
    res.status(200).json({ message: "Message sent successfully" });
  } catch (error) {
    console.log(error, "Error");
  }
});

app.get("/api/message/:conversationId", async (req, res) => {
  try {
    const checkMessages = async (conversationId) => {
      console.log(conversationId, "conversationId");
      const messages = await Messages.find({ conversationId });
      const messageUserData = Promise.all(
        messages.map(async (message) => {
          const user = await Users.findById(message.senderId);
          return {
            user: { id: user._id, email: user.email, fullName: user.fullName },
            message: message.message,
          };
        })
      );
      res.status(200).json(await messageUserData);
    };
    const conversationId = req.params.conversationId;
    if (conversationId === "new") {
      const checkConversation = await Conversations.find({
        members: { $all: [req.query.senderId, req.query.receiverId] },
      });
      if (checkConversation.length > 0) {
        checkMessages(checkConversation[0]._id);
      } else {
        return res.status(200).json([]);
      }
    } else {
      checkMessages(conversationId);
    }
  } catch (error) {
    console.log("Error", error);
  }
});

app.get("/api/users/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const users = await Users.find({ _id: { $ne: userId } });
    const usersData = Promise.all(
      users.map(async (user) => {
        return {
          user: {
            email: user.email,
            fullName: user.fullName,
            receiverId: user._id,
          },
        };
      })
    );
    res.status(200).json(await usersData);
  } catch (error) {
    console.log("Error", error);
  }
});

mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.once("open", () => {
  console.log("Connected to MongoDB");
});

app.listen(PORT_BACKEND, () => {
  console.log(`Backend server is running on ${PORT_BACKEND}`);
});
