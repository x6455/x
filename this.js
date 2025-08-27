const { Telegraf, Markup, session, Scenes } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
require('dotenv').config();
// --- Database and Configuration Files ---
const { usersDb, studentsDb } = require('./data');
const teachersDb = require('./teachersDb');
const config = require('./config');
const bot = new Telegraf(process.env.BOT_TOKEN);
console.log('School System Bot is running...');

// --- Helper Functions ---
const getUserById = (telegramId) => usersDb.data.users.find(u => u.telegramId === telegramId);
const getStudentById = (studentId) => studentsDb.data.students.find(s => s.studentId === studentId);
const getStudentsByParentId = (parentId) => studentsDb.data.students.filter(s => s.parentId === parentId);
const getTeacherById = (teacherId) => teachersDb.data.teachers.find(t => t.teacherId === teacherId);
const getAdmins = () => usersDb.data.users.filter(u => u.role === 'admin');

// Unique ID Generators
const generateUniqueStudentId = () => {
  let studentId;
  let isUnique = false;
  while (!isUnique) {
    studentId = crypto.randomInt(1000000000, 9999000000).toString();
    if (!getStudentById(studentId)) isUnique = true;
  }
  return studentId;
};

const generateUniqueTeacherId = () => {
  let teacherId;
  let isUnique = false;
  while (!isUnique) {
    teacherId = crypto.randomInt(1000000000, 9999000000).toString();
    if (!getTeacherById(teacherId)) isUnique = true;
  }
  return teacherId;
};

// --- State Management ---
const { leave } = Scenes.Stage;
const stage = new Scenes.Stage();

// --- Add Student Scene ---
const addStudentScene = new Scenes.BaseScene('add_student_scene');
addStudentScene.enter((ctx) => ctx.reply('📝 Please provide the student\'s full name.'));
addStudentScene.on('text', (ctx) => {
  const studentName = ctx.message.text.trim();
  if (studentName) {
    ctx.session.newStudentName = studentName;
    ctx.reply('Please enter the student\'s class (e.g., Grade 5, Grade 8, Grade 10).');
    ctx.scene.enter('add_student_class_scene');
  } else {
    ctx.reply('❌ Invalid name. Please try again.');
    ctx.scene.leave();
  }
});
stage.register(addStudentScene);

const addStudentClassScene = new Scenes.BaseScene('add_student_class_scene');
addStudentClassScene.on('text', (ctx) => {
  const studentClass = ctx.message.text.trim();
  const studentName = ctx.session.newStudentName;
  if (studentClass && studentName) {
    const studentId = generateUniqueStudentId();
    const newStudent = {
      studentId,
      name: studentName,
      class: studentClass,
      parentId: null,
      grades: {},
      schedule: { monday: 'N/A', tuesday: 'N/A' }
    };
    studentsDb.data.students.push(newStudent);
    studentsDb.write();
    ctx.replyWithMarkdown(`✅ Student "${studentName}" added to class "${studentClass}" with unique ID: **${studentId}**
_Share this ID with the parent for registration._`);
  } else {
    ctx.reply('❌ Invalid class. Please try again.');
  }
  ctx.session.newStudentName = null;
  ctx.scene.leave();
});
stage.register(addStudentClassScene);

// --- Add Student Database Scene ---
const uploadStudentDbScene = new Scenes.BaseScene('upload_student_db_scene');
uploadStudentDbScene.enter((ctx) => ctx.reply('📂 Please upload the student database file (JSON format).'));
uploadStudentDbScene.on('document', async (ctx) => {
  try {
    const fileId = ctx.message.document.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink);
    const studentsData = await response.json();
    if (!Array.isArray(studentsData)) {
      return ctx.reply('❌ Invalid file format. Please upload a JSON array of students.');
    }
    let addedCount = 0;
    studentsData.forEach(student => {
      if (student.name && student.class) {
        const studentId = generateUniqueStudentId();
        const newStudent = {
          studentId,
          name: student.name,
          class: student.class,
          parentId: student.parentId || null,
          grades: {},
          schedule: student.schedule || { monday: 'N/A', tuesday: 'N/A' }
        };
        studentsDb.data.students.push(newStudent);
        addedCount++;
        if (newStudent.parentId) {
          const parent = getUserById(newStudent.parentId);
          if (parent) {
            if (!parent.studentIds) parent.studentIds = [];
            if (!parent.studentIds.includes(newStudent.studentId)) {
              parent.studentIds.push(newStudent.studentId);
            }
            if (parent.role !== 'parent') parent.role = 'parent';
            usersDb.write();
          } else {
            console.log(`Parent ID ${newStudent.parentId} not found for student ${newStudent.studentId}. Setting to null.`);
            newStudent.parentId = null;
          }
        }
      }
    });
    studentsDb.write();
    ctx.reply(`✅ Successfully added ${addedCount} students from the database file.`);
  } catch (error) {
    console.error('Failed to process student database file:', error);
    ctx.reply('❌ Failed to process the file. Please ensure it is a valid JSON file and try again.');
  }
  ctx.scene.leave();
});
stage.register(uploadStudentDbScene);

// --- Add Teacher Scene ---
const addTeacherScene = new Scenes.BaseScene('add_teacher_scene');
addTeacherScene.enter((ctx) => ctx.reply('📝 Please provide the teacher\'s full name.'));
addTeacherScene.on('text', (ctx) => {
  const teacherName = ctx.message.text.trim();
  if (teacherName) {
    const teacherId = generateUniqueTeacherId();
    const newTeacher = {
      teacherId,
      name: teacherName,
      telegramId: null,
      subjects: [],
      pendingSubjects: []
    };
    teachersDb.data.teachers.push(newTeacher);
    teachersDb.write();
    ctx.replyWithMarkdown(`✅ Teacher "${teacherName}" added with unique ID: **${teacherId}**
_Share this ID with the teacher for registration._`);
  } else {
    ctx.reply('❌ Invalid name. Please try again.');
  }
  ctx.scene.leave();
});
addTeacherScene.leave((ctx) => ctx.reply('⬅️ Returning to user management menu.', {
  reply_markup: { keyboard: userManagementMenu.reply_markup.keyboard, resize_keyboard: true }
}));
stage.register(addTeacherScene);

// --- Remove Student Scene ---
const removeStudentScene = new Scenes.BaseScene('remove_student_scene');
removeStudentScene.enter((ctx) => ctx.reply('🆔 Please provide the student ID to remove.'));
removeStudentScene.on('text', (ctx) => {
  const studentId = ctx.message.text.trim();
  const index = studentsDb.data.students.findIndex(s => s.studentId === studentId);
  if (index !== -1) {
    const student = studentsDb.data.students[index];
    if (student.parentId) {
      const parent = usersDb.data.users.find(u => u.telegramId === student.parentId);
      if (parent) {
        parent.studentIds = parent.studentIds.filter(id => id !== studentId);
        if (parent.studentIds.length === 0) {
          parent.role = 'user';
        }
        usersDb.write();
      }
    }
    studentsDb.data.students.splice(index, 1);
    studentsDb.write();
    ctx.reply(`✅ Student with ID ${studentId} has been removed.`);
  } else {
    ctx.reply('❌ Student ID not found. Please try again.');
  }
  ctx.scene.leave();
});
removeStudentScene.leave((ctx) => ctx.reply('⬅️ Returning to student management menu.', {
  reply_markup: { keyboard: studentManagementMenu.reply_markup.keyboard, resize_keyboard: true }
}));
stage.register(removeStudentScene);

// --- Remove Teacher Scene ---
const removeTeacherScene = new Scenes.BaseScene('remove_teacher_scene');
removeTeacherScene.enter((ctx) => ctx.reply('🆔 Please provide the teacher ID to remove.'));
removeTeacherScene.on('text', (ctx) => {
  const teacherId = ctx.message.text.trim();
  const teacherIndex = teachersDb.data.teachers.findIndex(t => t.teacherId === teacherId);
  if (teacherIndex !== -1) {
    const teacher = teachersDb.data.teachers[teacherIndex];
    if (teacher.telegramId) {
      const userIndex = usersDb.data.users.findIndex(u => u.telegramId === teacher.telegramId);
      if (userIndex !== -1) {
        usersDb.data.users.splice(userIndex, 1);
        usersDb.write();
      }
    }
    teachersDb.data.teachers.splice(teacherIndex, 1);
    teachersDb.write();
    ctx.reply(`✅ Teacher with ID ${teacherId} has been removed.`);
  } else {
    ctx.reply('❌ Teacher ID not found. Please try again.');
  }
  ctx.scene.leave();
});
stage.register(removeTeacherScene);

// --- Register Parent Scene ---
const registerParentScene = new Scenes.BaseScene('register_parent_scene');
registerParentScene.enter((ctx) => ctx.reply('👤 To register, please provide your child\'s unique 10-digit student ID.'));
registerParentScene.on('text', async (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  if (student && !student.parentId && !student.pendingParentId) {
    let parent = getUserById(ctx.from.id);
    if (!parent) {
      parent = { telegramId: ctx.from.id, role: 'parent', name: ctx.from.first_name || 'Parent', studentIds: [], pendingStudentIds: [studentId] };
      usersDb.data.users.push(parent);
    } else {
      if (!parent.pendingStudentIds) parent.pendingStudentIds = [];
      if (!parent.pendingStudentIds.includes(studentId)) {
        parent.pendingStudentIds.push(studentId);
      }
    }
    student.pendingParentId = ctx.from.id;
    studentsDb.write();
    usersDb.write();
    const admins = getAdmins();
    for (const admin of admins) {
      try {
        await ctx.telegram.sendMessage(admin.telegramId, `🔔 *New Parent-Student Link Request:*
Parent: ${parent.name} (ID: ${ctx.from.id})
Student: ${student.name} (ID: ${studentId})`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_parent_${ctx.from.id}_${studentId}`)],
            [Markup.button.callback('❌ Deny', `deny_parent_${ctx.from.id}_${studentId}`)]
          ])
        });
      } catch (error) {
        console.error(`Failed to notify admin ${admin.telegramId}:`, error);
      }
    }
    ctx.reply(`✅ Your request to link with ${student.name} has been sent for admin approval.`);
  } else {
    ctx.reply('❌ Invalid student ID, already linked, or pending approval.');
  }
  ctx.scene.leave();
});
stage.register(registerParentScene);

// --- Link Another Student Scene ---
const linkAnotherStudentScene = new Scenes.BaseScene('link_another_student_scene');
linkAnotherStudentScene.enter((ctx) => ctx.reply('🔗 Please provide the student ID of the child you want to link.'));
linkAnotherStudentScene.on('text', async (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  const parent = getUserById(ctx.from.id);
  if (!parent) {
    return ctx.reply('❌ You must be a registered parent to use this feature.');
  }
  if (!student) {
    return ctx.reply('❌ Invalid student ID. Please try again.');
  }
  if (student.parentId || student.pendingParentId) {
    return ctx.reply('❌ This student is already linked or pending approval.');
  }
  if (parent.studentIds.includes(studentId) || parent.pendingStudentIds.includes(studentId)) {
    return ctx.reply('❌ This student is already linked or pending approval.');
  }
  if (!parent.pendingStudentIds) parent.pendingStudentIds = [];
  parent.pendingStudentIds.push(studentId);
  student.pendingParentId = ctx.from.id;
  usersDb.write();
  studentsDb.write();
  const admins = getAdmins();
  for (const admin of admins) {
    try {
      await ctx.telegram.sendMessage(admin.telegramId, `🔔 *New Parent-Student Link Request:*
Parent: ${parent.name} (ID: ${ctx.from.id})
Student: ${student.name} (ID: ${studentId})`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approve', `approve_parent_${ctx.from.id}_${studentId}`)],
          [Markup.button.callback('❌ Deny', `deny_parent_${ctx.from.id}_${studentId}`)]
        ])
      });
    } catch (error) {
      console.error(`Failed to notify admin ${admin.telegramId}:`, error);
    }
  }
  ctx.reply(`✅ Your request to link with ${student.name} has been sent for admin approval.`);
  ctx.scene.leave();
});
stage.register(linkAnotherStudentScene);

// --- Register Teacher Scene ---
const registerTeacherScene = new Scenes.BaseScene('register_teacher_scene');
registerTeacherScene.enter((ctx) => ctx.reply('🧑🏫 To register, please provide your unique 10-digit teacher ID.'));
registerTeacherScene.on('text', (ctx) => {
  const teacherId = ctx.message.text.trim();
  const teacher = getTeacherById(teacherId);
  if (teacher && !teacher.telegramId) {
    teacher.telegramId = ctx.from.id;
    let user = getUserById(ctx.from.id);
    if (!user) {
      user = { telegramId: ctx.from.id, role: 'teacher', name: ctx.from.first_name || 'Teacher', subjects: [] };
      usersDb.data.users.push(user);
    } else {
      user.role = 'teacher';
      user.subjects = [];
    }
    teachersDb.write();
    usersDb.write();
    ctx.reply(`✅ Registration successful! You are now registered as ${teacher.name}.`);
    ctx.scene.enter('register_teacher_subject_scene');
  } else {
    ctx.reply('❌ Invalid or already linked teacher ID. Please try again or contact support.');
  }
  ctx.scene.leave();
});
stage.register(registerTeacherScene);

// --- Admin Login Scene ---
const adminLoginScene = new Scenes.BaseScene('admin_login_scene');
adminLoginScene.enter((ctx) => ctx.reply('🔑 Please enter the secret admin code.'));
adminLoginScene.on('text', (ctx) => {
  const code = ctx.message.text.trim();
  if (code === config.ADMIN_SECRET_CODE) {
    let admin = getUserById(ctx.from.id);
    if (!admin) {
      admin = { telegramId: ctx.from.id, role: 'admin', name: ctx.from.first_name || 'Admin' };
      usersDb.data.users.push(admin);
      usersDb.write();
    }
    ctx.reply('✅ Admin login successful!', adminMenu);
  } else {
    ctx.reply('❌ Invalid code. Access denied.');
  }
  ctx.scene.leave();
});
stage.register(adminLoginScene);

// --- Add Admin Scene ---
const addAdminScene = new Scenes.BaseScene('add_admin_scene');
addAdminScene.enter((ctx) => ctx.reply('🆔 Please provide the Telegram User ID of the new admin.'));
addAdminScene.on('text', (ctx) => {
  const newAdminId = ctx.message.text.trim();
  const existingUser = getUserById(parseInt(newAdminId));
  if (existingUser) {
    if (existingUser.role === 'admin') {
      ctx.reply('❌ User is already an admin.');
    } else {
      existingUser.role = 'admin';
      usersDb.write();
      ctx.reply(`✅ User ${newAdminId} has been promoted to admin.`);
    }
  } else {
    ctx.reply('❌ User ID not found. The user must have interacted with the bot at least once.');
  }
  ctx.scene.leave();
});
stage.register(addAdminScene);

// --- Remove Admin Scene ---
const removeAdminScene = new Scenes.BaseScene('remove_admin_scene');
removeAdminScene.enter((ctx) => ctx.reply('🆔 Please provide the Telegram User ID of the admin to remove.'));
removeAdminScene.on('text', (ctx) => {
  const removedAdminId = ctx.message.text.trim();
  if (String(removedAdminId) === String(ctx.from.id)) {
    return ctx.reply('❌ You cannot remove yourself.');
  }
  const adminIndex = usersDb.data.users.findIndex(u => String(u.telegramId) === String(removedAdminId) && u.role === 'admin');
  if (adminIndex !== -1) {
    usersDb.data.users[adminIndex].role = 'user';
    usersDb.write();
    ctx.reply(`✅ Admin ${removedAdminId} has been demoted.`);
  } else {
    ctx.reply('❌ Admin not found.');
  }
  ctx.scene.leave();
});
stage.register(removeAdminScene);

// --- Edit Student Scene ---
const editStudentScene = new Scenes.BaseScene('edit_student_scene');
editStudentScene.enter((ctx) => ctx.reply('🆔 Please provide the student ID to edit.'));
editStudentScene.on('text', (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  if (!student) {
    ctx.reply('❌ Student ID not found. Please try again.');
    return ctx.scene.leave();
  }
  ctx.session.editStudentId = studentId;
  ctx.reply('Which field do you want to edit?', Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Name', 'edit_student_name'), Markup.button.callback('🔗 Parent ID', 'edit_student_parent')],
    [Markup.button.callback('🏫 Class', 'edit_student_class'), Markup.button.callback('⬅️ Cancel', 'cancel_edit_student')]
  ]));
});
editStudentScene.action('cancel_edit_student', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('❌ Edit cancelled.', {
    reply_markup: { keyboard: studentManagementMenu.reply_markup.keyboard, resize_keyboard: true }
  });
  ctx.scene.leave();
});
stage.register(editStudentScene);

const editStudentNameScene = new Scenes.BaseScene('edit_student_name_scene');
editStudentNameScene.enter((ctx) => ctx.reply('Please enter the new name for the student.'));
editStudentNameScene.on('text', (ctx) => {
  const newName = ctx.message.text.trim();
  const student = getStudentById(ctx.session.editStudentId);
  if (student && newName) {
    student.name = newName;
    studentsDb.write();
    ctx.reply(`✅ Student name updated to "${newName}".`);
  } else {
    ctx.reply('❌ Invalid name or student ID.');
  }
  ctx.scene.leave();
});
stage.register(editStudentNameScene);

const editStudentParentScene = new Scenes.BaseScene('edit_student_parent_scene');
editStudentParentScene.enter((ctx) => ctx.reply('Please enter the new parent\'s Telegram ID to link.'));
editStudentParentScene.on('text', (ctx) => {
  const newParentId = ctx.message.text.trim();
  const student = getStudentById(ctx.session.editStudentId);
  const newParent = getUserById(parseInt(newParentId));
  if (student && newParent && newParent.role === 'parent') {
    if (student.parentId) {
      const oldParent = getUserById(student.parentId);
      if (oldParent) {
        oldParent.studentIds = oldParent.studentIds.filter(id => id !== student.studentId);
        if (oldParent.studentIds.length === 0) oldParent.role = 'user';
      }
    }
    student.parentId = parseInt(newParentId);
    if (!newParent.studentIds.includes(student.studentId)) {
      newParent.studentIds.push(student.studentId);
    }
    studentsDb.write();
    usersDb.write();
    ctx.reply(`✅ Student ${student.name} linked to new parent ID ${newParentId}.`);
  } else {
    ctx.reply('❌ Invalid parent ID or student ID.');
  }
  ctx.scene.leave();
});
stage.register(editStudentParentScene);

const editStudentClassScene = new Scenes.BaseScene('edit_student_class_scene');
editStudentClassScene.enter((ctx) => ctx.reply('Please enter the new class for the student (e.g., Grade 5, Grade 8, Grade 10).'));
editStudentClassScene.on('text', (ctx) => {
  const newClass = ctx.message.text.trim();
  const student = getStudentById(ctx.session.editStudentId);
  if (student && newClass) {
    student.class = newClass;
    studentsDb.write();
    ctx.reply(`✅ Student class updated to "${newClass}".`);
  } else {
    ctx.reply('❌ Invalid class or student ID.');
  }
  ctx.scene.leave();
});
stage.register(editStudentClassScene);

// --- Edit Teacher Scene ---
const editTeacherScene = new Scenes.BaseScene('edit_teacher_scene');
editTeacherScene.enter((ctx) => ctx.reply('🆔 Please provide the teacher ID to edit.'));
editTeacherScene.on('text', (ctx) => {
  const teacherId = ctx.message.text.trim();
  const teacher = getTeacherById(teacherId);
  if (!teacher) {
    ctx.reply('❌ Teacher ID not found. Please try again.');
    return ctx.scene.leave();
  }
  ctx.session.editTeacherId = teacherId;
  ctx.reply('Which field do you want to edit?', Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Name', 'edit_teacher_name'), Markup.button.callback('📚 Subjects', 'edit_teacher_subjects')],
    [Markup.button.callback('⬅️ Cancel', 'cancel_edit_teacher')]
  ]));
});
editTeacherScene.action('cancel_edit_teacher', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('❌ Edit cancelled.', {
    reply_markup: { keyboard: userManagementMenu.reply_markup.keyboard, resize_keyboard: true }
  });
  ctx.scene.leave();
});
stage.register(editTeacherScene);

const editTeacherNameScene = new Scenes.BaseScene('edit_teacher_name_scene');
editTeacherNameScene.enter((ctx) => ctx.reply('Please enter the new name for the teacher.'));
editTeacherNameScene.on('text', (ctx) => {
  const newName = ctx.message.text.trim();
  const teacher = getTeacherById(ctx.session.editTeacherId);
  if (teacher && newName) {
    teacher.name = newName;
    teachersDb.write();
    const user = getUserById(teacher.telegramId);
    if (user) user.name = newName;
    usersDb.write();
    ctx.reply(`✅ Teacher name updated to "${newName}".`);
  } else {
    ctx.reply('❌ Invalid name or teacher ID.');
  }
  ctx.scene.leave();
});
stage.register(editTeacherNameScene);

const editTeacherSubjectsScene = new Scenes.BaseScene('edit_teacher_subjects_scene');
editTeacherSubjectsScene.enter((ctx) => ctx.reply('Please enter the new subjects for the teacher, separated by commas (e.g., Math, Science).'));
editTeacherSubjectsScene.on('text', (ctx) => {
  const newSubjects = ctx.message.text.trim().split(',').map(s => s.trim());
  const teacher = getTeacherById(ctx.session.editTeacherId);
  if (teacher && newSubjects.length > 0) {
    teacher.subjects = newSubjects;
    teachersDb.write();
    const user = getUserById(teacher.telegramId);
    if (user) user.subjects = newSubjects;
    usersDb.write();
    ctx.reply(`✅ Teacher subjects updated to "${newSubjects.join(', ')}".`);
  } else {
    ctx.reply('❌ Invalid subjects or teacher ID.');
  }
  ctx.scene.leave();
});
stage.register(editTeacherSubjectsScene);

// --- Announcement Recipient Scene ---
const announcementRecipientScene = new Scenes.BaseScene('announcement_recipient_scene');
announcementRecipientScene.enter((ctx) => {
  ctx.reply('📢 Who do you want to send the announcement to?', Markup.inlineKeyboard([
    [Markup.button.callback('👨‍👩‍👧‍👦 All Parents', 'announce_parents')],
    [Markup.button.callback('🧑🏫 All Teachers', 'announce_teachers')],
    [Markup.button.callback('⬅️ Cancel', 'cancel_announcement')]
  ]));
});
announcementRecipientScene.action('announce_parents', async (ctx) => {
  ctx.session.announcementTarget = 'parents';
  await ctx.answerCbQuery();
  await ctx.reply('📝 Please type the announcement message to send to all parents.');
  ctx.scene.enter('send_announcement_scene');
});
announcementRecipientScene.action('announce_teachers', async (ctx) => {
  ctx.session.announcementTarget = 'teachers';
  await ctx.answerCbQuery();
  await ctx.reply('📝 Please type the announcement message to send to all teachers.');
  ctx.scene.enter('send_announcement_scene');
});
announcementRecipientScene.action('cancel_announcement', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('❌ Announcement cancelled.', adminMenu);
  ctx.scene.leave();
});
stage.register(announcementRecipientScene);

// --- Send Announcement Scene ---
const sendAnnouncementScene = new Scenes.BaseScene('send_announcement_scene');
sendAnnouncementScene.on('text', async (ctx) => {
  const announcement = ctx.message.text.trim();
  if (!announcement) {
    ctx.reply('❌ Announcement cannot be empty. Please type the announcement again.');
    return;
  }
  const target = ctx.session.announcementTarget;
  if (!target) {
    ctx.reply('❌ Target audience not set. Please start again.');
    return ctx.scene.leave();
  }
  let recipients;
  if (target === 'parents') {
    recipients = usersDb.data.users.filter(u => u.role === 'parent');
  } else if (target === 'teachers') {
    recipients = usersDb.data.users.filter(u => u.role === 'teacher');
  } else {
    ctx.reply('❌ Invalid target audience.');
    return ctx.scene.leave();
  }
  for (const user of recipients) {
    try {
      await ctx.telegram.sendMessage(user.telegramId, `📢 *Announcement from Admin:*
${announcement}`, { parse_mode: 'Markdown' });
    } catch (error) {
      if (error.response && error.response.error_code === 403) {
        console.log(`User ${user.telegramId} has blocked the bot.`);
      } else {
        console.error(`Failed to send announcement to ${user.telegramId}:`, error);
      }
    }
  }
  ctx.reply(`✅ Announcement sent to all ${target}.`, adminMenu);
  ctx.scene.leave();
});
stage.register(sendAnnouncementScene);

// --- Teacher Subject Registration Scene ---
const registerTeacherSubjectScene = new Scenes.BaseScene('register_teacher_subject_scene');
registerTeacherSubjectScene.enter((ctx) =>
  ctx.reply('🧑🏫 Please enter the subject you teach (e.g., Math, Science).')
);
registerTeacherSubjectScene.on('text', (ctx) => {
  const subject = ctx.message.text.trim();
  if (!subject) {
    return ctx.reply('❌ Subject cannot be empty. Please enter the subject you teach.');
  }
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (user && teacher) {
    teacher.pendingSubjects.push(subject);
    teachersDb.write();
    const admins = getAdmins();
    for (const admin of admins) {
      try {
        ctx.telegram.sendMessage(admin.telegramId, `🔔 *New Subject Verification Request from ${teacher.name}:*
Subject: **${subject}**
Teacher ID: **${teacher.teacherId}**`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve', `approve_subject_${teacher.teacherId}_${subject.replace(/ /g, '_')}`)],
            [Markup.button.callback('❌ Deny', `deny_subject_${teacher.teacherId}_${subject.replace(/ /g, '_')}`)]
          ])
        });
      } catch (error) {
        console.error(`Failed to notify admin ${admin.telegramId}:`, error);
      }
    }
    ctx.reply(`✅ Your request to add "${subject}" has been sent for admin verification.`, teacherMenu);
  } else {
    ctx.reply('❌ An error occurred. Please contact an admin.');
  }
  ctx.scene.leave();
});
stage.register(registerTeacherSubjectScene);

// --- Manage Grades Scene ---
const manageGradesScene = new Scenes.BaseScene('manage_grades_scene');
manageGradesScene.enter((ctx) => {
  if (ctx.session.currentStudentId) {
    const student = getStudentById(ctx.session.currentStudentId);
    if (!student) {
      ctx.reply('❌ Student ID not found. Please enter a valid Student ID.');
      return ctx.scene.leave();
    }
    const user = getUserById(ctx.from.id);
    const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
    const subjects = teacher.subjects;
    if (!subjects || subjects.length === 0) {
      ctx.reply('❌ You have no subjects set. Please contact an admin or add a new subject.');
      return ctx.scene.leave();
    }
    const subjectButtons = subjects.map(s => [Markup.button.callback(s, `select_subject_${s.replace(/ /g, '_')}`)]);
    return ctx.reply(`Please select the subject for ${student.name}'s grade:`, Markup.inlineKeyboard(subjectButtons));
  }
  ctx.reply('🆔 Please enter the Student ID to update grades.');
});
manageGradesScene.on('text', (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  if (!student) {
    return ctx.reply('❌ Student ID not found. Please enter a valid Student ID.');
  }
  ctx.session.currentStudentId = studentId;
  ctx.session.currentStudentName = student.name;
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  const subjects = teacher.subjects;
  if (!subjects || subjects.length === 0) {
    ctx.reply('❌ You have no subjects set. Please contact an admin or add a new subject.');
    return ctx.scene.leave();
  }
  const subjectButtons = subjects.map(s => [Markup.button.callback(s, `select_subject_${s.replace(/ /g, '_')}`)]);
  ctx.reply(`Please select the subject for ${student.name}'s grade:`, Markup.inlineKeyboard(subjectButtons));
});
stage.register(manageGradesScene);

// --- Enter Grade Score Scene ---
const enterGradeScoreScene = new Scenes.BaseScene('enter_grade_score_scene');
enterGradeScoreScene.enter((ctx) => ctx.reply('📝 Please enter the new grade score (e.g., A, B+, 85).'));
enterGradeScoreScene.on('text', (ctx) => {
  const gradeInput = ctx.message.text.trim();
  if (!gradeInput) {
    return ctx.reply('❌ Grade cannot be empty. Please enter the grade score.');
  }
  ctx.session.newGradeScore = gradeInput;
  ctx.reply('Please enter the purpose of this grade (e.g., Midterm, Final, Quiz).');
  ctx.scene.enter('enter_grade_purpose_scene');
});
stage.register(enterGradeScoreScene);

// --- Enter Grade Purpose Scene ---
const enterGradePurposeScene = new Scenes.BaseScene('enter_grade_purpose_scene');
enterGradePurposeScene.on('text', (ctx) => {
  const purposeInput = ctx.message.text.trim();
  if (!purposeInput) {
    return ctx.reply('❌ Purpose cannot be empty. Please enter the purpose.');
  }
  const user = getUserById(ctx.from.id);
  const subject = ctx.session.currentSubject.toLowerCase();
  const studentId = ctx.session.currentStudentId;
  const student = getStudentById(studentId);
  if (!student || !subject) {
    ctx.reply('❌ Error: Student or subject not found.');
    return ctx.scene.leave();
  }
  if (!student.grades) student.grades = {};
  if (!student.grades[subject]) student.grades[subject] = [];
  student.grades[subject].push({
    score: ctx.session.newGradeScore,
    purpose: purposeInput,
    date: new Date().toISOString(),
    gradeId: crypto.randomBytes(16).toString('hex') // Unique ID for each grade
  });
  studentsDb.write();
  ctx.reply(`✅ New grade "${ctx.session.newGradeScore}" with purpose "${purposeInput}" added for ${student.name} in ${ctx.session.currentSubject}.`, teacherMenu);
  ctx.session.currentStudentId = null;
  ctx.session.newGradeScore = null;
  ctx.session.currentSubject = null;
  ctx.session.currentStudentName = null;
  ctx.scene.leave();
});
stage.register(enterGradePurposeScene);

// --- Edit Grade Scene ---
const editGradeScene = new Scenes.BaseScene('edit_grade_scene');
editGradeScene.enter((ctx) => ctx.reply('📝 Please enter the new grade score.'));
editGradeScene.on('text', (ctx) => {
  const newScore = ctx.message.text.trim();
  if (!newScore) {
    return ctx.reply('❌ Grade cannot be empty. Please enter the grade score.');
  }
  ctx.session.newGradeScore = newScore;
  ctx.reply('Please enter the new purpose for this grade.');
  ctx.scene.enter('edit_grade_purpose_scene');
});
stage.register(editGradeScene);

const editGradePurposeScene = new Scenes.BaseScene('edit_grade_purpose_scene');
editGradePurposeScene.on('text', (ctx) => {
  const newPurpose = ctx.message.text.trim();
  if (!newPurpose) {
    return ctx.reply('❌ Purpose cannot be empty. Please enter the purpose.');
  }
  const student = getStudentById(ctx.session.currentStudentId);
  const subject = ctx.session.currentSubject.toLowerCase();
  const gradeId = ctx.session.currentGradeId;
  if (!student || !subject || !gradeId) {
    ctx.reply('❌ Error: Invalid data.');
    return ctx.scene.leave();
  }
  const gradeIndex = student.grades[subject].findIndex(g => g.gradeId === gradeId);
  if (gradeIndex === -1) {
    ctx.reply('❌ Grade not found.');
    return ctx.scene.leave();
  }
  student.grades[subject][gradeIndex].score = ctx.session.newGradeScore;
  student.grades[subject][gradeIndex].purpose = newPurpose;
  student.grades[subject][gradeIndex].date = new Date().toISOString();
  studentsDb.write();
  ctx.reply(`✅ Grade updated for ${student.name} in ${ctx.session.currentSubject}.`, teacherMenu);
  ctx.session.currentStudentId = null;
  ctx.session.currentSubject = null;
  ctx.session.currentGradeId = null;
  ctx.session.newGradeScore = null;
  ctx.scene.leave();
});
stage.register(editGradePurposeScene);

// --- Search Scene for Admins and Teachers ---
const searchScene = new Scenes.BaseScene('search_scene');
searchScene.enter((ctx) => {
  ctx.reply('🔍 Please enter the name or unique ID to search for.');
});
searchScene.on('text', (ctx) => {
  const query = ctx.message.text.trim().toLowerCase();
  const user = getUserById(ctx.from.id);
  let results = '';
  let inlineKeyboard = [];
  if (user.role === 'admin') {
    // Search for students
    const studentResults = studentsDb.data.students.filter(s =>
      s.name.toLowerCase().includes(query) || s.studentId.includes(query)
    );
    if (studentResults.length > 0) {
      results += '🎓 *Found Students:*\\n';
      results += studentResults.map(s => `• Name: ${s.name}, Class: ${s.class}, ID: ${s.studentId}`).join('\\n');
    }
    // Search for teachers
    const teacherResults = teachersDb.data.teachers.filter(t =>
      t.name.toLowerCase().includes(query) || t.teacherId.includes(query)
    );
    if (teacherResults.length > 0) {
      if (results) results += '\\n';
      results += '🧑🏫 *Found Teachers:*\\n';
      results += teacherResults.map(t => `• Name: ${t.name}, ID: ${t.teacherId}, Subjects: ${t.subjects.join(', ') || 'N/A'}`).join('\\n');
    }
  } else if (user.role === 'teacher') {
    // Teachers only search for students
    const studentResults = studentsDb.data.students.filter(s =>
      s.name.toLowerCase().includes(query) || s.studentId.includes(query)
    );
    if (studentResults.length > 0) {
      results += '🎓 *Found Students:*\\n';
      studentResults.forEach(s => {
        results += `• Name: ${s.name}, Class: ${s.class}, ID: ${s.studentId}\\n`;
        inlineKeyboard.push([Markup.button.callback(`💯 Manage Grades for ${s.name}`, `manage_grades_${s.studentId}`)]);
      });
    }
  }
  if (results) {
    ctx.replyWithMarkdown(results, { reply_markup: Markup.inlineKeyboard(inlineKeyboard).reply_markup });
  } else {
    ctx.reply('❌ No matching results found.');
  }
  ctx.scene.leave();
});
stage.register(searchScene);

// --- Contact Parent Scene ---
const contactParentScene = new Scenes.BaseScene('contact_parent_scene');
contactParentScene.enter((ctx) => ctx.reply('🆔 Please enter the student ID of the parent you want to contact.'));
contactParentScene.on('text', (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  if (!student || !student.parentId) {
    return ctx.reply('❌ Student ID not found or student has no linked parent.');
  }
  ctx.session.recipientId = student.parentId;
  ctx.reply('📝 Please type the message you want to send to the parent.');
  ctx.scene.enter('send_message_scene');
});
stage.register(contactParentScene);

const sendMessageScene = new Scenes.BaseScene('send_message_scene');
sendMessageScene.on('text', async (ctx) => {
  const message = ctx.message.text.trim();
  const recipientId = ctx.session.recipientId;
  if (!message || !recipientId) {
    ctx.reply('❌ Message cannot be empty or recipient not set.');
    return ctx.scene.leave();
  }
  try {
    const sender = getUserById(ctx.from.id);
    const senderRole = sender.role === 'teacher' ? 'Teacher' : 'Admin';
    await ctx.telegram.sendMessage(recipientId, `📢 *Message from ${senderRole} (${sender.name}):*
${message}`, { parse_mode: 'Markdown' });
    ctx.reply('✅ Message sent successfully.', teacherMenu);
  } catch (error) {
    if (error.response && error.response.error_code === 403) {
      ctx.reply('❌ Failed to send message. The recipient has blocked the bot.');
    } else {
      console.error(`Failed to send message:`, error);
      ctx.reply('❌ Failed to send message. Please try again later.');
    }
  } finally {
    ctx.session.recipientId = null;
    ctx.scene.leave();
  }
});
stage.register(sendMessageScene);

// --- Contact Admin Scene for Parents ---
const contactAdminScene = new Scenes.BaseScene('contact_admin_scene');
contactAdminScene.enter((ctx) => ctx.reply('📝 Please type the message you want to send to the administrators.'));
contactAdminScene.on('text', async (ctx) => {
  const message = ctx.message.text.trim();
  if (!message) {
    return ctx.reply('❌ Message cannot be empty.');
  }
  const admins = getAdmins();
  const senderName = ctx.from.first_name || 'Parent';
  if (admins.length > 0) {
    for (const admin of admins) {
      try {
        await ctx.telegram.sendMessage(admin.telegramId, `📢 *New message from a parent (${senderName}):*
${message}`, { parse_mode: 'Markdown' });
      } catch (error) {
        if (error.response && error.response.error_code === 403) {
          console.log(`Admin ${admin.telegramId} has blocked the bot.`);
        } else {
          console.error(`Failed to send message to admin ${admin.telegramId}:`, error);
        }
      }
    }
    ctx.reply('✅ Your message has been sent to the administrators.', parentMenu);
  } else {
    ctx.reply('❌ No administrators found to send the message to.');
  }
  ctx.scene.leave();
});
stage.register(contactAdminScene);

// --- Teacher Add Subject Scene ---
const addSubjectScene = new Scenes.BaseScene('add_subject_scene');
addSubjectScene.enter((ctx) => ctx.reply('📚 Please enter the new subject you want to add. An admin will review your request.'));
addSubjectScene.on('text', async (ctx) => {
  const newSubject = ctx.message.text.trim();
  if (!newSubject) {
    return ctx.reply('❌ Subject cannot be empty.');
  }
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (!teacher) {
    return ctx.reply('❌ An error occurred. Please contact an admin.');
  }
  if (teacher.subjects.includes(newSubject) || teacher.pendingSubjects.includes(newSubject)) {
    return ctx.reply(`❌ "${newSubject}" is already one of your subjects or is pending verification.`);
  }
  teacher.pendingSubjects.push(newSubject);
  teachersDb.write();
  const admins = getAdmins();
  for (const admin of admins) {
    try {
      await ctx.telegram.sendMessage(admin.telegramId, `🔔 *New Subject Verification Request from ${teacher.name}:*
Subject: **${newSubject}**
Teacher ID: **${teacher.teacherId}**`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approve', `approve_subject_${teacher.teacherId}_${newSubject.replace(/ /g, '_')}`)],
          [Markup.button.callback('❌ Deny', `deny_subject_${teacher.teacherId}_${newSubject.replace(/ /g, '_')}`)]
        ])
      });
    } catch (error) {
      if (error.response && error.response.error_code === 403) {
        console.log(`Admin ${admin.telegramId} has blocked the bot.`);
      } else {
        console.error(`Failed to notify admin ${admin.telegramId}:`, error);
      }
    }
  }
  ctx.reply(`✅ Your request to add "${newSubject}" has been sent for admin verification.`, teacherMenu);
  ctx.scene.leave();
});
stage.register(addSubjectScene);

// --- Teacher Remove Subject Scene ---
const removeSubjectScene = new Scenes.BaseScene('remove_subject_scene');
removeSubjectScene.enter((ctx) => {
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (!teacher || teacher.subjects.length === 0) {
    ctx.reply('❌ You have no subjects to remove.', teacherMenu);
    return ctx.scene.leave();
  }
  const subjectButtons = teacher.subjects.map(s => [Markup.button.callback(s, `remove_subject_${s.replace(/ /g, '_')}`)]);
  ctx.reply('📚 Please select the subject you want to remove:', Markup.inlineKeyboard(subjectButtons));
});
stage.register(removeSubjectScene);

// --- Teacher Manually Add Student Scene ---
const teacherAddStudentScene = new Scenes.BaseScene('teacher_add_student_scene');
teacherAddStudentScene.enter((ctx) => ctx.reply('🆔 Please enter the Student ID to manually add to your student list.'));
teacherAddStudentScene.on('text', async (ctx) => {
  const studentId = ctx.message.text.trim();
  const student = getStudentById(studentId);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (!student) {
    return ctx.reply('❌ Student ID not found. Please enter a valid Student ID.');
  }
  if (!teacher || teacher.subjects.length === 0) {
    return ctx.reply('❌ You have no subjects assigned. Please add one first.');
  }
  ctx.session.studentToAddId = studentId;
  const subjectButtons = teacher.subjects.map(s => [Markup.button.callback(s, `add_student_to_subject_${studentId}_${s.replace(/ /g, '_')}`)]);
  subjectButtons.push([Markup.button.callback('Add to All Subjects', `add_student_all_subjects_${studentId}`)]);
  ctx.reply(`Please select the subject(s) to add ${student.name} to:`, Markup.inlineKeyboard(subjectButtons));
});
stage.register(teacherAddStudentScene);

// --- Teacher Class Announcement Scene ---
const teacherAnnouncementScene = new Scenes.BaseScene('teacher_announcement_scene');
teacherAnnouncementScene.on('text', async (ctx) => {
  const announcement = ctx.message.text.trim();
  if (!announcement) {
    return ctx.reply('❌ Announcement cannot be empty.');
  }
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  const subject = ctx.session.announcementSubject;
  if (!user || !teacher || !subject) {
    return ctx.reply('❌ An error occurred. Please contact an admin.');
  }
  const students = studentsDb.data.students.filter(s => s.grades && s.grades[subject.toLowerCase()] && s.grades[subject.toLowerCase()].length > 0);
  const parentIds = [...new Set(students.map(s => s.parentId).filter(id => id !== null))];
  for (const parentId of parentIds) {
    try {
      await ctx.telegram.sendMessage(parentId, `📢 *Message from your child's ${subject} Teacher:*
${announcement}`, { parse_mode: 'Markdown' });
    } catch (error) {
      if (error.response && error.response.error_code === 403) {
        console.log(`Parent ${parentId} has blocked the bot.`);
      } else {
        console.error(`Failed to send announcement to parent ${parentId}:`, error);
      }
    }
  }
  ctx.reply('✅ Announcement sent to all parents of your students.', teacherMenu);
  ctx.scene.leave();
});
stage.register(teacherAnnouncementScene);

// --- Unbind Parent Scene ---
const unbindParentScene = new Scenes.BaseScene('unbind_parent_scene');
unbindParentScene.enter((ctx) => ctx.reply('🆔 Please provide the parent\'s Telegram ID to unbind.'));
unbindParentScene.on('text', (ctx) => {
  const parentId = ctx.message.text.trim();
  const parent = getUserById(parseInt(parentId));
  if (!parent || parent.role !== 'parent') {
    return ctx.reply('❌ Parent not found or not a parent.');
  }
  
  // Remove all student links for this parent
  studentsDb.data.students.forEach(student => {
    if (student.parentId === parseInt(parentId)) {
      student.parentId = null;
      student.pendingParentId = null;
    }
  });
  
  // Clear parent's student IDs
  parent.studentIds = [];
  parent.pendingStudentIds = [];
  
  usersDb.write();
  studentsDb.write();
  
  ctx.reply(`✅ Parent with ID ${parentId} has been unbound from all students.`);
  ctx.scene.leave();
});
stage.register(unbindParentScene);

// --- Menus ---
const adminMenu = Markup.keyboard([
  ['🧑‍🎓 Students', '👥 Users'],
  ['📢 Announcements', '🔍 Search']
]).resize();

const userManagementMenu = Markup.keyboard([
  ['➕ Add Admin', '➖ Remove Admin', '✏️ Edit Teacher'],
  ['➕ Add Teacher', '➖ Remove Teacher'],
  ['👀 View Admins', '👀 View Teachers', '👀 View Parents'],
  ['⬅️ Back to Admin Menu']
]).resize();

const studentManagementMenu = Markup.keyboard([
  ['➕ Add Student', '➖ Remove Student', '✏️ Edit Student'],
  ['📂 Upload Student DB', '🔗 Unbind Parent'],
  ['👀 View All Students'],
  ['⬅️ Back to Admin Menu']
]).resize();

const parentMenu = Markup.keyboard([
  ['💯 View Grades', '🗓️ Schedule'],
  ['🧑‍🎓 My Profile', '🔗 Link Another Student'],
  ['💬 Contact Admin']
]).resize();

const teacherMenu = Markup.keyboard([
  ['💯 Manage Grades', '📚 My Students'],
  ['📢 Announce Class', '💬 Contact Parent'],
  ['🧑‍🎓 My Profile', '🔍 Search Student']
]).resize();

const teacherProfileMenu = Markup.inlineKeyboard([
  [Markup.button.callback('➕ Add New Subject', 'add_new_subject'), Markup.button.callback('➖ Remove Subject', 'remove_subject')],
  [Markup.button.callback('⬅️ Back to Teacher Menu', 'back_to_teacher')]
]);

const parentProfileMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔗 Linked Students', 'view_linked_children')],
  [Markup.button.callback('⬅️ Back to Parent Menu', 'back_to_parent')]
]);

const registrationMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🧑🏫 Register as Teacher', 'register_teacher')],
  [Markup.button.callback('👨👩👧👦 Register as Parent', 'register_parent')]
]);

// --- Bot Middleware ---
bot.use(session());
bot.use(stage.middleware());

// --- Bot Commands ---
bot.start(async (ctx) => {
  const user = getUserById(ctx.from.id);
  const welcomeMessage = '🤖 Welcome to the School System Bot! Please register with your assigned code or choose your role.';
  try {
    if (user) {
      if (user.role === 'admin') return await ctx.reply(`👋 Welcome back, ${user.name}!`, adminMenu);
      if (user.role === 'teacher') return await ctx.reply(`👋 Welcome back, ${user.name}!`, teacherMenu);
      if (user.role === 'parent') return await ctx.reply(`👋 Welcome back, ${user.name}!`, parentMenu);
    }
    await ctx.reply(welcomeMessage, { reply_markup: registrationMenu.reply_markup });
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.log(`User ${ctx.from.id} has blocked the bot.`);
    } else {
      throw err;
    }
  }
});

bot.command('admin', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    return ctx.reply('⚙️ Admin Panel', adminMenu);
  }
  ctx.scene.enter('admin_login_scene');
});

// --- Text/Keyboard Handlers ---
bot.hears('🧑‍🎓 Students', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.reply('🧑‍🎓 Student Management:', studentManagementMenu);
  }
});

bot.hears('👥 Users', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.reply('👥 User Management:', userManagementMenu);
  }
});

bot.hears('📢 Announcements', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('announcement_recipient_scene');
  } else {
    ctx.reply('❌ You do not have permission to send announcements.');
  }
});

bot.hears('🔍 Search', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('search_scene');
  } else {
    ctx.reply('❌ You are not authorized to use this feature.');
  }
});

bot.hears('➕ Add Admin', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('add_admin_scene');
  }
});

bot.hears('➕ Add Teacher', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('add_teacher_scene');
  }
});

bot.hears('➖ Remove Admin', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('remove_admin_scene');
  }
});

bot.hears('➖ Remove Teacher', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('remove_teacher_scene');
  }
});

bot.hears('✏️ Edit Teacher', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('edit_teacher_scene');
  }
});

bot.hears('👀 View Admins', (ctx) => {
  const admins = usersDb.data.users.filter(u => u.role === 'admin');
  if (admins.length > 0) {
    const adminList = admins.map(u => `ID: ${u.telegramId}, Name: ${u.name}`).join('\\n');
    ctx.replyWithMarkdown(`**Current Admins:**\\n${adminList}`);
  } else {
    ctx.reply('No admins found.');
  }
});

bot.hears('👀 View Teachers', (ctx) => {
  const teachers = teachersDb.data.teachers;
  if (teachers.length === 0) return ctx.reply('No teachers found.');
  const list = teachers.map(t => `ID: ${t.teacherId}, Name: ${t.name}, Subjects: ${t.subjects.join(', ') || 'N/A'}, Telegram ID: ${t.telegramId || 'N/A'}`).join('\\n');
  ctx.replyWithMarkdown(`**All Teachers:**\\n${list}`);
});

bot.hears('👀 View Parents', (ctx) => {
  const parents = usersDb.data.users.filter(u => u.role === 'parent');
  if (parents.length === 0) return ctx.reply('No parents found.');
  const list = parents.map(p => {
    const linkedStudentsCount = p.studentIds ? p.studentIds.length : 0;
    return `ID: ${p.telegramId}, Name: ${p.name}, Linked Students: ${linkedStudentsCount}`;
  }).join('\\n');
  ctx.replyWithMarkdown(`**All Parents:**\\n${list}`);
});

bot.hears('🔗 Unbind Parent', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('unbind_parent_scene');
  }
});

bot.hears('➕ Add Student', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('add_student_scene');
  }
});

bot.hears('➖ Remove Student', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('remove_student_scene');
  }
});

bot.hears('✏️ Edit Student', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('edit_student_scene');
  }
});

bot.hears('📂 Upload Student DB', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'admin') {
    ctx.scene.enter('upload_student_db_scene');
  }
});

bot.hears('👀 View All Students', (ctx) => {
  const students = studentsDb.data.students.map(s => `ID: ${s.studentId}, Name: ${s.name}, Class: ${s.class || 'N/A'}, Parent ID: ${s.parentId || 'N/A'}`).join('\\n');
  ctx.replyWithMarkdown(students || '👀 No students found.');
});

bot.hears('⬅️ Back to Admin Menu', (ctx) => {
  ctx.reply('⬅️ Returning to admin menu.', adminMenu);
});

// Parent Handlers
bot.hears('💯 View Grades', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'parent') {
    const students = getStudentsByParentId(user.telegramId);
    if (students.length === 0) {
      return ctx.reply('❌ You are not linked to any students.');
    }
    let fullGradeList = '📋 *Your Child(ren)\\'s Grades:*\\n';
    students.forEach(student => {
      fullGradeList += `--- *${student.name}* (Class: ${student.class || 'N/A'}) ---\\n`;
      const grades = student.grades;
      if (Object.keys(grades).length === 0) {
        fullGradeList += 'No grades found.\\n';
      } else {
        for (const [subject, gradeArray] of Object.entries(grades)) {
          if (Array.isArray(gradeArray) && gradeArray.length > 0) {
            fullGradeList += `*${subject.charAt(0).toUpperCase() + subject.slice(1)}*:\\n`;
            gradeArray.forEach(gradeInfo => {
              fullGradeList += ` - Score: ${gradeInfo.score}, Purpose: ${gradeInfo.purpose}, Date: ${new Date(gradeInfo.date).toLocaleDateString()}\\n`;
            });
          }
        }
      }
      fullGradeList += '\\n';
    });
    return ctx.replyWithMarkdown(fullGradeList);
  } else {
    ctx.reply('❌ You are not authorized to view grades.');
  }
});

bot.hears('🗓️ Schedule', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'parent') {
    const students = getStudentsByParentId(user.telegramId);
    if (students.length === 0) {
      return ctx.reply('❌ No schedule found.');
    }
    let fullScheduleList = '**Your Child(ren)\\'s Schedules**\\n';
    students.forEach(student => {
      fullScheduleList += `--- *${student.name}* ---\\n`;
      fullScheduleList += `🗓️ Monday: ${student.schedule.monday || 'N/A'}\\n`;
      fullScheduleList += `🗓️ Tuesday: ${student.schedule.tuesday || 'N/A'}\\n`;
    });
    return ctx.replyWithMarkdown(fullScheduleList);
  } else {
    ctx.reply('❌ You are not authorized to view schedule.');
  }
});

bot.hears('💬 Contact Admin', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'parent') {
    ctx.scene.enter('contact_admin_scene');
  } else {
    ctx.reply('❌ You are not authorized to contact admins.');
  }
});

bot.hears('🧑‍🎓 My Profile', (ctx) => {
  const parent = usersDb.data.users.find(u => u.telegramId === ctx.from.id && u.role === 'parent');
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (parent) {
    let profileMessage = `**Your Profile:**\\n` +
      `**Name:** ${parent.name}\\n` +
      `**Telegram ID:** ${parent.telegramId}`;
    ctx.replyWithMarkdown(profileMessage, parentProfileMenu);
  } else if (teacher) {
    let profileMessage = `**Your Profile:**\\n` +
      `**Name:** ${teacher.name}\\n` +
      `**Teacher ID:** ${teacher.teacherId}\\n` +
      `**Subjects:** ${teacher.subjects.join(', ') || 'N/A'}\\n` +
      `**Pending Subjects:** ${teacher.pendingSubjects.join(', ') || 'N/A'}`;
    ctx.replyWithMarkdown(profileMessage, teacherProfileMenu);
  } else {
    ctx.reply('❌ Your profile could not be found.');
  }
});

bot.hears('🔗 Link Another Student', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'parent') {
    ctx.scene.enter('link_another_student_scene');
  } else {
    ctx.reply('❌ You must be a parent to link students.');
  }
});

// Teacher Handlers
bot.hears('💯 Manage Grades', (ctx) => {
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (user && user.role === 'teacher' && teacher && teacher.subjects.length > 0) {
    ctx.scene.enter('manage_grades_scene');
  } else {
    ctx.reply('❌ You are not authorized or you have no subjects assigned.');
  }
});

bot.hears('📚 My Students', (ctx) => {
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (user && user.role === 'teacher' && teacher && teacher.subjects.length > 0) {
    let studentList = `**Students in your classes:**\\n`;
    let hasStudents = false;
    teacher.subjects.forEach(subject => {
      const students = studentsDb.data.students.filter(s => s.grades && s.grades[subject.toLowerCase()] && s.grades[subject.toLowerCase()].length > 0);
      if (students.length > 0) {
        hasStudents = true;
        studentList += `*${subject} Class:*\\n`;
        studentList += students.map(s => `• Name: ${s.name}, ID: ${s.studentId}`).join('\\n');
        studentList += '\\n';
      }
    });
    const addButton = [[Markup.button.callback('➕ Add Student to Class', 'teacher_add_student')]];
    if (hasStudents) {
      ctx.replyWithMarkdown(studentList, Markup.inlineKeyboard(addButton));
    } else {
      ctx.replyWithMarkdown('No students found for any of your subjects.\\nYou can add students to your classes below.', Markup.inlineKeyboard(addButton));
    }
  } else {
    ctx.reply('❌ You do not have a subject assigned or no students found.');
  }
});

bot.hears('📢 Announce Class', (ctx) => {
  const user = getUserById(ctx.from.id);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (user && teacher && teacher.subjects.length > 0) {
    const subjectButtons = teacher.subjects.map(s => [Markup.button.callback(s, `announce_subject_${s.replace(/ /g, '_')}`)]);
    ctx.reply('Please select the subject for the announcement:', Markup.inlineKeyboard(subjectButtons));
  } else {
    ctx.reply('❌ You are not authorized or you have no subjects to send an announcement for.');
  }
});

bot.hears('💬 Contact Parent', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'teacher') {
    ctx.scene.enter('contact_parent_scene');
  } else {
    ctx.reply('❌ You are not authorized to contact parents.');
  }
});

bot.hears('🔍 Search Student', (ctx) => {
  const user = getUserById(ctx.from.id);
  if (user && user.role === 'teacher') {
    ctx.scene.enter('search_scene');
  } else {
    ctx.reply('❌ You are not authorized to use this feature.');
  }
});

// --- Action Handlers ---
bot.action('register_teacher', (ctx) => ctx.scene.enter('register_teacher_scene'));
bot.action('register_parent', (ctx) => ctx.scene.enter('register_parent_scene'));

bot.action(/^announce_subject_(.+)$/, (ctx) => {
  const subject = ctx.match[1].replace(/_/g, ' ');
  ctx.session.announcementSubject = subject;
  ctx.answerCbQuery();
  ctx.reply(`📢 Please type the announcement to send to the parents of your students in ${subject}.`);
  ctx.scene.enter('teacher_announcement_scene');
});

bot.action(/^manage_grades_(\d+)$/, (ctx) => {
  const studentId = ctx.match[1];
  ctx.session.currentStudentId = studentId;
  ctx.answerCbQuery();
  ctx.scene.enter('manage_grades_scene');
});

bot.action('view_linked_children', (ctx) => {
  const parent = usersDb.data.users.find(u => u.telegramId === ctx.from.id && u.role === 'parent');
  if (parent) {
    const studentIds = parent.studentIds || [];
    if (studentIds.length === 0) {
      return ctx.reply('You are not linked to any students.');
    }
    const students = studentIds.map(id => getStudentById(id)).filter(s => s);
    const studentList = students.map(s => `• Name: ${s.name}, ID: ${s.studentId}, Class: ${s.class || 'N/A'}`).join('\\n');
    ctx.replyWithMarkdown(`**Linked Students:**\\n${studentList}`);
  } else {
    ctx.reply('❌ Your profile could not be found.');
  }
});

bot.action('add_new_subject', (ctx) => {
  ctx.scene.enter('add_subject_scene');
});

bot.action('remove_subject', (ctx) => {
  ctx.scene.enter('remove_subject_scene');
});

bot.action('teacher_add_student', (ctx) => {
  ctx.answerCbQuery();
  ctx.scene.enter('teacher_add_student_scene');
});

bot.action('back_to_teacher', (ctx) => {
  ctx.reply('⬅️ Returning to teacher menu.', teacherMenu);
});

bot.action('back_to_parent', (ctx) => {
  ctx.reply('⬅️ Returning to parent menu.', parentMenu);
});

bot.action('edit_student_name', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('edit_student_name_scene');
});

bot.action('edit_student_parent', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('edit_student_parent_scene');
});

bot.action('edit_student_class', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('edit_student_class_scene');
});

bot.action('edit_teacher_name', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('edit_teacher_name_scene');
});

bot.action('edit_teacher_subjects', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter('edit_teacher_subjects_scene');
});

bot.action(/^select_subject_(.+)$/, (ctx) => {
  const subject = ctx.match[1].replace(/_/g, ' ');
  ctx.session.currentSubject = subject;
  ctx.answerCbQuery();
  const student = getStudentById(ctx.session.currentStudentId);
  const studentGrades = student.grades[subject.toLowerCase()] || [];
  let gradeHistory = `*Current grades for ${student.name} in ${subject}:*\\n`;
  let editButtons = [];
  if (studentGrades.length > 0) {
    studentGrades.forEach(gradeInfo => {
      gradeHistory += `- Score: ${gradeInfo.score}, Purpose: ${gradeInfo.purpose}, Date: ${new Date(gradeInfo.date).toLocaleDateString()}\\n`;
      editButtons.push([Markup.button.callback(`Edit: ${gradeInfo.score} (${gradeInfo.purpose})`, `edit_grade_${gradeInfo.gradeId}`)]);
    });
  } else {
    gradeHistory += 'No grades found.\\n';
  }
  ctx.replyWithMarkdown(`${gradeHistory}
📝 Please enter the new grade score (e.g., A, B+, 85).`, Markup.inlineKeyboard(editButtons));
  ctx.scene.enter('enter_grade_score_scene');
});

bot.action(/^edit_grade_(.+)$/, (ctx) => {
  const gradeId = ctx.match[1];
  ctx.session.currentGradeId = gradeId;
  ctx.answerCbQuery();
  ctx.scene.enter('edit_grade_scene');
});

bot.action(/^remove_subject_(.+)$/, (ctx) => {
  const subjectToRemove = ctx.match[1].replace(/_/g, ' ');
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (teacher) {
    teacher.subjects = teacher.subjects.filter(s => s !== subjectToRemove);
    teachersDb.write();
    const user = getUserById(teacher.telegramId);
    if (user) {
      user.subjects = user.subjects.filter(s => s !== subjectToRemove);
      usersDb.write();
    }
    ctx.reply(`✅ Subject "${subjectToRemove}" has been removed from your profile.`, teacherMenu);
  } else {
    ctx.reply('❌ An error occurred. Subject not found.', teacherMenu);
  }
  ctx.answerCbQuery();
  ctx.scene.leave();
});

bot.action(/^add_student_to_subject_(\d+)_(.+)$/, (ctx) => {
  const studentId = ctx.match[1];
  const subject = ctx.match[2].replace(/_/g, ' ');
  const student = getStudentById(studentId);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (student && teacher) {
    const subjectKey = subject.toLowerCase();
    if (!student.grades) student.grades = {};
    if (!student.grades[subjectKey]) {
      student.grades[subjectKey] = [];
    }
    studentsDb.write();
    ctx.reply(`✅ Student ${student.name} has been added to your ${subject} student list.`);
  } else {
    ctx.reply('❌ Student or teacher not found.');
  }
  ctx.answerCbQuery();
  ctx.scene.leave();
});

bot.action(/^add_student_all_subjects_(\d+)$/, (ctx) => {
  const studentId = ctx.match[1];
  const student = getStudentById(studentId);
  const teacher = teachersDb.data.teachers.find(t => t.telegramId === ctx.from.id);
  if (student && teacher) {
    teacher.subjects.forEach(subject => {
      const subjectKey = subject.toLowerCase();
      if (!student.grades) student.grades = {};
      if (!student.grades[subjectKey]) {
        student.grades[subjectKey] = [];
      }
    });
    studentsDb.write();
    ctx.reply(`✅ Student ${student.name} has been added to all your subjects.`);
  } else {
    ctx.reply('❌ Student or teacher not found.');
  }
  ctx.answerCbQuery();
  ctx.scene.leave();
});

bot.action(/^approve_subject_(\d+)_(.+)$/, (ctx) => {
  const teacherId = ctx.match[1];
  const subject = ctx.match[2].replace(/_/g, ' ');
  const teacher = getTeacherById(teacherId);
  if (teacher && teacher.pendingSubjects.includes(subject)) {
    teacher.subjects.push(subject);
    teacher.pendingSubjects = teacher.pendingSubjects.filter(s => s !== subject);
    teachersDb.write();
    const user = getUserById(teacher.telegramId);
    if (user) {
      user.subjects.push(subject);
      usersDb.write();
      ctx.replyWithMarkdown(`✅ Subject **${subject}** has been approved for **${teacher.name}**.`);
      try {
        ctx.telegram.sendMessage(user.telegramId, `✅ Your request to add subject "${subject}" has been approved by an admin!`);
      } catch (e) { /* ignore */ }
    }
  } else {
    ctx.reply('❌ Request not found.');
  }
  ctx.answerCbQuery();
});

bot.action(/^deny_subject_(\d+)_(.+)$/, (ctx) => {
  const teacherId = ctx.match[1];
  const subject = ctx.match[2].replace(/_/g, ' ');
  const teacher = getTeacherById(teacherId);
  if (teacher && teacher.pendingSubjects.includes(subject)) {
    teacher.pendingSubjects = teacher.pendingSubjects.filter(s => s !== subject);
    teachersDb.write();
    const user = getUserById(teacher.telegramId);
    ctx.replyWithMarkdown(`❌ Subject **${subject}** has been denied for **${teacher.name}**.`);
    try {
      ctx.telegram.sendMessage(user.telegramId, `❌ Your request to add subject "${subject}" has been denied by an admin.`);
    } catch (e) { /* ignore */ }
  } else {
    ctx.reply('❌ Request not found.');
  }
  ctx.answerCbQuery();
});

bot.action(/^approve_parent_(\d+)_(\d+)$/, (ctx) => {
  const parentId = ctx.match[1];
  const studentId = ctx.match[2];
  const parent = getUserById(parseInt(parentId));
  const student = getStudentById(studentId);
  if (parent && student && student.pendingParentId === parseInt(parentId)) {
    student.parentId = parseInt(parentId);
    student.pendingParentId = null;
    if (!parent.studentIds) parent.studentIds = [];
    if (!parent.studentIds.includes(studentId)) {
      parent.studentIds.push(studentId);
    }
    parent.pendingStudentIds = parent.pendingStudentIds.filter(id => id !== studentId);
    if (parent.role !== 'parent') parent.role = 'parent';
    usersDb.write();
    studentsDb.write();
    ctx.replyWithMarkdown(`✅ Parent ${parent.name} has been linked to student ${student.name}.`);
    try {
      ctx.telegram.sendMessage(parentId, `✅ Your request to link with student ${student.name} (ID: ${studentId}) has been approved!`);
    } catch (e) { /* ignore */ }
  } else {
    ctx.reply('❌ Request not found or already processed.');
  }
  ctx.answerCbQuery();
});

bot.action(/^deny_parent_(\d+)_(\d+)$/, (ctx) => {
  const parentId = ctx.match[1];
  const studentId = ctx.match[2];
  const parent = getUserById(parseInt(parentId));
  const student = getStudentById(studentId);
  if (parent && student && student.pendingParentId === parseInt(parentId)) {
    student.pendingParentId = null;
    parent.pendingStudentIds = parent.pendingStudentIds.filter(id => id !== studentId);
    if (parent.studentIds.length === 0 && parent.pendingStudentIds.length === 0) {
      parent.role = 'user';
    }
    usersDb.write();
    studentsDb.write();
    ctx.replyWithMarkdown(`❌ Parent ${parent.name} link request for student ${student.name} has been denied.`);
    try {
      ctx.telegram.sendMessage(parentId, `❌ Your request to link with student ${student.name} (ID: ${studentId}) has been denied.`);
    } catch (e) { /* ignore */ }
  } else {
    ctx.reply('❌ Request not found or already processed.');
  }
  ctx.answerCbQuery();
});

// --- Launch bot ---
bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));