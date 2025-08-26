const express = require("express");
const mysql = require("mysql");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const nodemailer = require("nodemailer");

const multer = require("multer");
const xlsx = require("xlsx");
const upload = multer({ dest: "uploads/" });
const bcrypt = require("bcrypt");
const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "Idigishk@gmail.com", // Replace with your Gmail
    pass: "kpsrdvlbzkjjnjqa", // Your 16-digit app password
  },
});

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "crm_db",
});

db.connect((err) => {
  if (err) throw err;
  console.log("MySQL Connected!");
});

// Function to send login notification email
const sendLoginNotification = (userEmail, userName, loginTime) => {
  const mailOptions = {
    from: "Idigishk@gmail.com", // Replace with your Gmail
    to: "Idigishk@gmail.com", // Destination email
    subject: "Login Notification-CRM System",
    html: `
      <h2>CRM Login Alert</h2>
      <p>A user has logged into the CRM system:</p>
      <ul>
        <li><strong>User:</strong> ${userName}</li>
        <li><strong>Email:</strong> ${userEmail}</li>
        <li><strong>Login Time:</strong> ${loginTime}</li>
      </ul>
      <p>This is an automated notification. Please do not reply to this email.</p>
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Login notification email sent:", info.response);
    }
  });
};

// === Signup ===
app.post("/signup", async (req, res) => {
  const { name, email, phone, password, designation, dob, role } = req.body;
  // REMOVED the hashing
  const sql = `INSERT INTO users (name, email, phone, password, designation, dob, role) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.query(
    sql,
    [name, email, phone, password, designation, dob, role || "counselor"],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({ message: "Signup successful" });
    }
  );
});

// Add this endpoint to your server.js
app.post("/upload-leads", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No file uploaded" });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    let totalRecords = data.length;
    let uploadedRecords = 0;
    let duplicateRecords = 0;

    // Process each record
    for (const record of data) {
      const { name, email, phone, source } = record;

      // Check for duplicates
      const duplicateCheck = await new Promise((resolve) => {
        const sql = `SELECT COUNT(*) as count FROM leads WHERE name = ? OR email = ? OR phone = ?`;
        db.query(sql, [name, email, phone], (err, results) => {
          if (err) return resolve(true); // Skip if error
          resolve(results[0].count > 0);
        });
      });

      if (duplicateCheck) {
        duplicateRecords++;
        continue;
      }

      // Insert new record
      await new Promise((resolve) => {
        const sql = `INSERT INTO leads (name, email, phone, source, created_at) VALUES (?, ?, ?, ?, NOW())`;
        db.query(sql, [name, email, phone, source || ""], (err) => {
          if (err) return resolve();
          uploadedRecords++;
          resolve();
        });
      });
    }

    res.send({
      success: true,
      totalRecords,
      uploadedRecords,
      duplicateRecords,
      message: "File processed successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send({ message: "Error processing file" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// === Login ===
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const trimmedPassword = password.trim(); // Trim input password
  const sql = `SELECT * FROM users WHERE email = ?`;
  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).send(err);
    if (results.length === 0)
      return res.status(401).send({ message: "User not found" });

    const dbPassword = results[0].password.trim(); // Trim DB password
    if (trimmedPassword !== dbPassword) {
      return res.status(401).send({ message: "Invalid password" });
    }

    // Send login notification email
    const loginTime = new Date().toLocaleString();
    sendLoginNotification(results[0].email, results[0].name, loginTime);

    res.send({ user: results[0] });
  });
});



////////////////////////////

// === Get All Users ===
app.get("/users", (req, res) => {
  const sql = "SELECT id, name, email, role FROM users ORDER BY name";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to fetch users" 
      });
    }
    res.json({
      success: true,
      data: results
    });
  });
});

// === Get Attendance Data with Filters ===
app.get("/attendance", (req, res) => {
  try {
    const { month, year, userId, userName, status } = req.query;
    
    let query = `
      SELECT 
        a.*,
        u.name as user_name
      FROM attendance a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    let params = [];
    
    // Add filters
    if (month && year) {
      query += ' AND MONTH(a.date) = ? AND YEAR(a.date) = ?';
      params.push(month, year);
    } else if (year) {
      query += ' AND YEAR(a.date) = ?';
      params.push(year);
    }
    
    if (userId) {
      query += ' AND a.user_id = ?';
      params.push(userId);
    }
    
    if (userName) {
      query += ' AND u.name LIKE ?';
      params.push(`%${userName}%`);
    }
    
    if (status && status !== 'All') {
      query += ' AND a.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY a.date DESC, u.name ASC';
    
    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error fetching attendance:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to fetch attendance data" 
        });
      }
      
      // Calculate summary if needed
      let summary = {};
      if (userId || userName) {
        summary = calculateAttendanceSummary(results);
      }
      
      res.json({
        success: true,
        data: results,
        summary: summary
      });
    });
    
  } catch (error) {
    console.error("Error in attendance API:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

// === Get Attendance Summary for a User ===
app.get("/attendance/summary", (req, res) => {
  const { userId, month, year } = req.query;
  
  if (!userId || !month || !year) {
    return res.status(400).json({
      success: false,
      message: "userId, month, and year are required parameters"
    });
  }
  
  const query = `
    SELECT 
      status,
      COUNT(*) as count
    FROM attendance 
    WHERE user_id = ? 
      AND MONTH(date) = ? 
      AND YEAR(date) = ?
    GROUP BY status
  `;
  
  db.query(query, [userId, month, year], (err, results) => {
    if (err) {
      console.error("Error fetching attendance summary:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to fetch attendance summary" 
      });
    }
    
    // Format the summary
    const summary = {
      present: 0,
      absent: 0,
      leave: 0,
      holiday: 0,
      half_day: 0
    };
    
    results.forEach(row => {
      const status = row.status.toLowerCase().replace(' ', '_');
      if (summary.hasOwnProperty(status)) {
        summary[status] = row.count;
      }
    });
    
    // Get user details
    const userQuery = "SELECT name FROM users WHERE id = ?";
    db.query(userQuery, [userId], (userErr, userResults) => {
      if (userErr) {
        console.error("Error fetching user details:", userErr);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to fetch user details" 
        });
      }
      
      res.json({
        success: true,
        user: userResults[0] || {},
        summary: summary,
        total: results.reduce((sum, row) => sum + row.count, 0)
      });
    });
  });
});

// Helper function to calculate attendance summary
function calculateAttendanceSummary(attendanceData) {
  const summary = {
    present: 0,
    absent: 0,
    leave: 0,
    holiday: 0,
    half_day: 0,
    full_day: 0
  };
  
  attendanceData.forEach(record => {
    const status = record.status.toLowerCase().replace(' ', '_');
    if (summary.hasOwnProperty(status)) {
      summary[status]++;
    }
  });
  
  return summary;
}

// === Get Attendance Status Options ===
app.get("/attendance/status-options", (req, res) => {
  res.json({
    success: true,
    data: ["Present", "Absent", "Leave", "Holiday", "Half Day", "Full Day"]
  });
});



// === Assign Leads Randomly ===
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
app.post("/assign-leads", (req, res) => {
  const { adminId, counselorIds, leads } = req.body;

  // Shuffle leads to ensure random assignment
  const shuffledLeads = shuffleArray([...leads]);
  const assignments = [];

  for (let i = 0; i < shuffledLeads.length; i++) {
    const counselorId = counselorIds[i % counselorIds.length];
    assignments.push({
      leadId: shuffledLeads[i],
      counselorId: counselorId,
      adminId: adminId,
      assignedAt: new Date(),
    });
  }

  // Assuming a table `leads` with fields: id, assigned_to, assigned_by, assigned_at
  const updatePromises = assignments.map(
    ({ leadId, counselorId, adminId, assignedAt }) => {
      return new Promise((resolve, reject) => {
        db.query(
          "UPDATE leads SET assigned_to = ?, assigned_by = ?, assigned_at = ? WHERE id = ?",
          [counselorId, adminId, assignedAt, leadId],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });
    }
  );

  Promise.all(updatePromises)
    .then(() => {
      res.status(200).json({
        message: "Leads assigned successfully",
        assignments,
      });
    })
    .catch((error) => {
      console.error("Assignment error:", error);
      res.status(500).json({ message: "Error assigning leads", error });
    });
});

// === Edit Lead ===
app.post("/edit-lead", (req, res) => {
  const { id, name, email, phone, source } = req.body;

  const sql = `UPDATE leads SET name = ?, email = ?, phone = ?, source = ? WHERE id = ?`;

  db.query(sql, [name, email, phone, source, id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: "Error updating lead" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Lead not found" });
    }

    res.send({ message: "Lead updated successfully" });
  });
});

// Add to your server.js
app.get("/counselors", (req, res) => {
  db.query(
    `SELECT id, name, email FROM users WHERE role = 'counselor'`,
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.send(results);
    }
  );
});

app.get("/new-leads", (req, res) => {
  const date = req.query.date;
  let query = `SELECT * FROM leads`;
  let params = [];

  if (date) {
    query += ` WHERE DATE(assigned_at) = ?`;
    params.push(date);
  }

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// === Leads API ===

// Get leads for a specific user
app.get("/leads/user/:userId", (req, res) => {
  const userId = req.params.userId;
  const { date, status, search } = req.query;

  let sql = `SELECT * FROM leads WHERE assigned_to = ?`;
  const params = [userId];

  if (date) {
    sql += ` AND DATE(created_at) = ?`;
    params.push(date);
  }

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  if (search) {
    sql += ` AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY created_at DESC`;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Create new lead
app.post("/leads", (req, res) => {
  const { name, email, phone, source, assigned_to } = req.body;

  const sql = `INSERT INTO leads (name, email, phone, source, assigned_to, created_at) 
               VALUES (?, ?, ?, ?, ?, NOW())`;

  db.query(sql, [name, email, phone, source, assigned_to], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send({
      message: "Lead created successfully",
      leadId: result.insertId,
    });
  });
});

// Update lead status
app.put("/leads/:id/status", (req, res) => {
  const leadId = req.params.id;
  const { status, remarks, follow_up_date, follow_up_time } = req.body;

  const sql = `UPDATE leads 
               SET status = ?, remarks = ?, follow_up_date = ?, follow_up_time = ?, status_updated_at = NOW() 
               WHERE id = ?`;

  db.query(
    sql,
    [status, remarks, follow_up_date, follow_up_time, leadId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({ message: "Lead status updated" });
    }
  );
});

// Get all status options
app.get("/leads/status-options", (req, res) => {
  res.send([
    "New",
    "Interested",
    "Not Interested",
    "Follow-up",
    "Deal Done",
    "Not Picked",
    "Wrong Number",
  ]);
});

// Dashboard statistics - Cleaned version (no priority)
app.get("/dashboard/stats", (req, res) => {
  const userId = req.query.userId;
  const today = new Date().toISOString().split("T")[0];

  // Get counts for different stats (without priority-based queries)
  const statsQueries = {
    totalLeads: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ?`,
    convertedLeads: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND status = 'Deal Done'`,
    newLeadsToday: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND DATE(created_at) = ?`,
    dealsClosedToday: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND status = 'Deal Done' AND DATE(status_updated_at) = ?`,
    scheduledCalls: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND follow_up_date = ? AND follow_up_time IS NOT NULL`,
    completedCalls: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND follow_up_date = ? AND status = 'Completed'`,
    followUps: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND follow_up_date = ?`,
    pendingFollowUps: `SELECT COUNT(*) as count FROM leads WHERE assigned_to = ? AND status = 'Follow-up'`,
  };

  const results = {};
  let queriesCompleted = 0;
  const totalQueries = Object.keys(statsQueries).length;

  Object.keys(statsQueries).forEach((key) => {
    const query = statsQueries[key];
    const params = [userId];

    // Add today's date for queries that require it
    if (query.includes("= ?") && query.split("?").length - 1 > 1) {
      params.push(today);
    }

    db.query(query, params, (err, result) => {
      if (err) {
        if (!res.headersSent) {
          return res.status(500).send(err);
        }
        return;
      }

      results[key] = result[0].count;
      queriesCompleted++;

      if (queriesCompleted === totalQueries) {
        res.send(results);
      }
    });
  });
});

// Recent leads
app.get("/leads/recent", (req, res) => {
  const userId = req.query.userId;
  const limit = req.query.limit || 3;

  const sql = `SELECT * FROM leads 
               WHERE assigned_to = ? 
               ORDER BY created_at DESC 
               LIMIT ?`;

  db.query(sql, [userId, parseInt(limit)], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// Today's schedule
app.get("/leads/schedule", (req, res) => {
  const userId = req.query.userId;
  const date = req.query.date;

  const sql = `SELECT * FROM leads 
               WHERE assigned_to = ? AND follow_up_date = ?
               ORDER BY follow_up_time ASC`;

  db.query(sql, [userId, date], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// === Track Activity (Admins/SuperAdmin) ===
app.get("/track-activity/:userId", (req, res) => {
  const userId = req.params.userId;
  db.query(
    `SELECT * FROM leads WHERE assigned_to = ? ORDER BY status_updated_at DESC`,
    [userId],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.send(results);
    }
  );
});

// === Reminder for Pending Leads (older than 4 hrs) ===
app.get("/pending-alert/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT * FROM leads
    WHERE assigned_to = ? AND status = 'new'
    AND TIMESTAMPDIFF(HOUR, assigned_at, NOW()) >= 4
  `;
  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// GET /attendance./today
app.get("/attendance/today/:id", (req, res) => {
  const employeeId = req.params.id;
  const currentDate = new Date().toISOString().split("T")[0];

  const sql = "SELECT * FROM attendance WHERE user_id = ? AND date = ?";
  db.query(sql, [employeeId, currentDate], (err, results) => {
    if (err) {
      console.error("Error fetching today's attendance:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Please mark check-in first" });
    }

    res.status(200).json(results[0]);
  });
});

// POST /mark-attendance
app.post("/mark-attendance", (req, res) => {
  const employeeId = req.body.employeeId;
  const employeeName = req.body.employeeName;
  const checkInLocation = req.body.checkInLocation;
  const currentDate = new Date().toISOString().split("T")[0];

  const checkSql = "SELECT * FROM attendance WHERE user_id = ? AND date = ?";
  db.query(checkSql, [employeeId, currentDate], (err, results) => {
    if (err) {
      console.error("Error checking attendance:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.length > 0) {
      return res
        .status(400)
        .json({ message: "Attendance already marked for today" });
    }

    const insertSql = `
      INSERT INTO attendance 
      (user_id, user_name, date, check_in_location, check_in, status)
      VALUES (?, ?, ?, ?, CURTIME(), "Present")
    `;
    db.query(
      insertSql,
      [employeeId, employeeName, currentDate, checkInLocation],
      (err2) => {
        if (err2) {
          console.error("Error inserting attendance:", err2);
          return res.status(500).json({ message: "Internal server error" });
        }

        // Fetch and return the inserted row
        const selectSql =
          "SELECT * FROM attendance WHERE user_id = ? AND date = ?";
        db.query(selectSql, [employeeId, currentDate], (err3, resultRow) => {
          if (err3) {
            console.error("Error fetching inserted attendance:", err3);
            return res
              .status(500)
              .json({ message: "Attendance inserted but fetch failed" });
          }

          res.status(200).json({
            message: "Attendance marked successfully!",
            data: resultRow[0],
          });
        });
      }
    );
  });
});

// Add these endpoints to your existing server.js

// === Get User Counts ===
app.get("/admin/user-counts", (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as totalUsers,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as adminCount,
      SUM(CASE WHEN role = 'counselor' THEN 1 ELSE 0 END) as counselorCount
    FROM users
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// === Get Lead Conversion Stats ===
app.get("/admin/lead-stats", (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as totalLeads,
      SUM(CASE WHEN status = 'Deal Done' THEN 1 ELSE 0 END) as convertedLeads,
      (SUM(CASE WHEN status = 'Deal Done' THEN 1 ELSE 0 END) / COUNT(*)) * 100 as conversionRate
    FROM leads
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// === Get Active Sessions ===
app.get("/admin/active-sessions", (req, res) => {
  // In a real app, you'd track active sessions in Redis or similar
  // This is a simplified version
  const sql =
    "SELECT COUNT(DISTINCT assigned_to) as activeSessions FROM leads WHERE status_updated_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results[0]);
  });
});

// === Get Recent Activities ===
app.get("/admin/recent-activities", (req, res) => {
  const { startDate, endDate, counselorId } = req.query;

  let sql = `
    SELECT 
      l.id as lead_id,
      l.name as lead_name,
      l.status,
      l.status_updated_at,
      l.remarks,
      u.name as counselor_name,
      u.id as counselor_id,
      a.name as admin_name
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    LEFT JOIN users a ON l.assigned_by = a.id
    WHERE l.status_updated_at IS NOT NULL
  `;

  const params = [];

  if (startDate && endDate) {
    sql += ` AND DATE(l.status_updated_at) BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  if (counselorId) {
    sql += ` AND l.assigned_to = ?`;
    params.push(counselorId);
  }

  sql += ` ORDER BY l.status_updated_at DESC LIMIT 50`;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// === Get Counselor Performance ===
app.get("/admin/counselor-performance", (req, res) => {
  const { startDate, endDate } = req.query;

  let sql = `
    SELECT 
      u.id as counselor_id,
      u.name as counselor_name,
      COUNT(l.id) as total_leads,
      SUM(CASE WHEN l.status = 'Deal Done' THEN 1 ELSE 0 END) as deals_closed,
      (SUM(CASE WHEN l.status = 'Deal Done' THEN 1 ELSE 0 END) / COUNT(l.id)) * 100 as conversion_rate
    FROM users u
    LEFT JOIN leads l ON u.id = l.assigned_to
    WHERE u.role = 'counselor'
  `;

  const params = [];

  if (startDate && endDate) {
    sql += ` AND DATE(l.status_updated_at) BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  sql += ` GROUP BY u.id ORDER BY deals_closed DESC`;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send(err);
    res.send(results);
  });
});

// POST /mark-checkout
app.post("/mark-checkout", (req, res) => {
  const employeeId = req.body.employeeId;
  const checkOutLocation = req.body.checkOutLocation;
  const currentDate = new Date().toISOString().split("T")[0];

  const checkSql = "SELECT * FROM attendance WHERE user_id = ? AND date = ?";
  db.query(checkSql, [employeeId, currentDate], (err, results) => {
    if (err) {
      console.error("Error checking attendance:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "You haven't marked check-in yet." });
    }

    const attendance = results[0];

    if (attendance.check_out) {
      return res.status(400).json({ message: "Check-out already marked." });
    }

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const checkIn = new Date(`${todayStr}T${attendance.check_in}`);
    const diffMs = now - checkIn;
    const totalHours = diffMs / (1000 * 60 * 60);
    const updatedStatus = totalHours < 8 ? "Half Day" : "Full Day";

    console.log(
      `total hours : ${totalHours.toString()}, \n updated status : ${updatedStatus} `
    );

    const updateSql = `
      UPDATE attendance 
      SET check_out = CURTIME(), check_out_location = ?, status = ?
      WHERE user_id = ? AND date = ?
    `;

    db.query(
      updateSql,
      [checkOutLocation, updatedStatus, employeeId, currentDate],
      (err2) => {
        if (err2) {
          console.error("Error updating check-out:", err2);
          return res.status(500).json({ message: "Internal server error" });
        }

        db.query(checkSql, [employeeId, currentDate], (err3, updated) => {
          if (err3 || updated.length === 0) {
            return res
              .status(500)
              .json({ message: "Error fetching updated data" });
          }

          const checkInTime = new Date(`1970-01-01T${updated[0].check_in}`);
          const checkOutTime = new Date(`1970-01-01T${updated[0].check_out}`);
          const diff = checkOutTime - checkInTime;

          const h = Math.floor(diff / (1000 * 60 * 60))
            .toString()
            .padStart(2, "0");
          const m = Math.floor((diff / (1000 * 60)) % 60)
            .toString()
            .padStart(2, "0");
          const s = Math.floor((diff / 1000) % 60)
            .toString()
            .padStart(2, "0");
          const workingHours = `${h}:${m}:${s}`;

          res.json({
            message: "Checked out successfully!",
            workingHours: workingHours,
            data: updated[0],
          });
        });
      }
    );
  });
});

app.listen(port, () => console.log(`CRM Server running on port ${port}`));
