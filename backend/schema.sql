/* ======================
Table: admin
====================== */
CREATE TABLE `admin` (
`admin_id` VARCHAR(191) NOT NULL,
`email` VARCHAR(191) NOT NULL,
`password_hashed` VARCHAR(191) NOT NULL,
`name` VARCHAR(191) NOT NULL,
`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`admin_id`),
UNIQUE KEY `admin_email_unique` (`email`),
KEY `admin_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: user
====================== */
CREATE TABLE `user` (
`user_id` VARCHAR(191) NOT NULL,
`user_name` VARCHAR(191) NOT NULL,
`name` VARCHAR(191) NOT NULL,
`email` VARCHAR(191) NOT NULL,
`password_hashed` VARCHAR(191) NOT NULL,
`bio` VARCHAR(500) NULL,
`avatar_url` VARCHAR(191) NULL,
`account_type` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
`follower_cnt` INT NOT NULL DEFAULT 0,
`following_cnt` INT NOT NULL DEFAULT 0,
`post_cnt` INT NOT NULL DEFAULT 0,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
`updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
PRIMARY KEY (`user_id`),
UNIQUE KEY `user_user_name_unique` (`user_name`),
UNIQUE KEY `user_email_unique` (`email`),
KEY `user_account_type_idx` (`account_type`),
KEY `user_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: follows
====================== */
CREATE TABLE `follows` (
`followerId` VARCHAR(191) NOT NULL,
`followingId` VARCHAR(191) NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`followerId`, `followingId`),
KEY `follows_followerId_idx` (`followerId`),
KEY `follows_followingId_idx` (`followingId`),
KEY `follows_createdAt_idx` (`createdAt`),
CONSTRAINT `follows_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `follows_followingId_fkey` FOREIGN KEY (`followingId`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: blocks
====================== */
CREATE TABLE `blocks` (
`blockerId` VARCHAR(191) NOT NULL,
`blockedId` VARCHAR(191) NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`blockerId`, `blockedId`),
KEY `blocks_blockerId_idx` (`blockerId`),
KEY `blocks_blockedId_idx` (`blockedId`),
CONSTRAINT `blocks_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `blocks_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: followrequest
====================== */
CREATE TABLE `followrequest` (
`fr_id` VARCHAR(191) NOT NULL,
`requester_id` VARCHAR(191) NOT NULL,
`target_id` VARCHAR(191) NOT NULL,
`status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`fr_id`),
UNIQUE KEY `followrequest_requester_target_unique` (`requester_id`, `target_id`),
KEY `followrequest_target_status_idx` (`target_id`, `status`),
CONSTRAINT `followrequest_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `followrequest_target_id_fkey` FOREIGN KEY (`target_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: post
====================== */
CREATE TABLE `post` (
`post_id` VARCHAR(191) NOT NULL,
`user_id` VARCHAR(191) NOT NULL,
`post_type` ENUM('TEXT', 'IMAGE', 'VIDEO') NOT NULL,
`caption` VARCHAR(2000) NULL,
`media_url` VARCHAR(500) NULL,
`like_cnt` INT NOT NULL DEFAULT 0,
`comment_cnt` INT NOT NULL DEFAULT 0,
`no_of_reports` INT NOT NULL DEFAULT 0,
`is_hidden` TINYINT(1) NOT NULL DEFAULT 0,
`posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`post_id`),
KEY `post_user_id_idx` (`user_id`),
KEY `post_posted_at_idx` (`posted_at`),
KEY `post_is_hidden_idx` (`is_hidden`),
KEY `post_no_of_reports_idx` (`no_of_reports`),
CONSTRAINT `post_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: reportmonitor
====================== */
CREATE TABLE `reportmonitor` (
`post_id` VARCHAR(191) NOT NULL,
`no_of_reports` INT NOT NULL,
`status` INT NOT NULL,
PRIMARY KEY (`post_id`),
KEY `reportmonitor_no_of_reports_idx` (`no_of_reports`),
KEY `reportmonitor_status_idx` (`status`),
CONSTRAINT `reportmonitor_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post` (`post_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: comment
====================== */
CREATE TABLE `comment` (
`comment_id` VARCHAR(191) NOT NULL,
`content` VARCHAR(1000) NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
`updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
`post_id` VARCHAR(191) NOT NULL,
`user_id` VARCHAR(191) NOT NULL,
`parent_cmtid` VARCHAR(191) NULL,
PRIMARY KEY (`comment_id`),
KEY `comment_createdAt_idx` (`createdAt`),
KEY `comment_post_id_idx` (`post_id`),
KEY `comment_user_id_idx` (`user_id`),
KEY `comment_parent_cmtid_idx` (`parent_cmtid`),
CONSTRAINT `comment_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post` (`post_id`) ON DELETE CASCADE,
CONSTRAINT `comment_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `comment_parent_cmtid_fkey` FOREIGN KEY (`parent_cmtid`) REFERENCES `comment` (`comment_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: like
====================== */
CREATE TABLE `like` (
`user_id` VARCHAR(191) NOT NULL,
`post_id` VARCHAR(191) NOT NULL,
`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`user_id`, `post_id`),
KEY `like_user_id_idx` (`user_id`),
KEY `like_post_id_idx` (`post_id`),
CONSTRAINT `like_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `like_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post` (`post_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: message
====================== */
CREATE TABLE `message` (
`message_id` VARCHAR(191) NOT NULL,
`content` VARCHAR(2000) NULL,
`media_url` VARCHAR(500) NULL,
`post_id` VARCHAR(191) NULL,
`sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
`updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
`sender_id` VARCHAR(191) NOT NULL,
`receiver_id` VARCHAR(191) NOT NULL,
PRIMARY KEY (`message_id`),
KEY `message_sender_id_idx` (`sender_id`),
KEY `message_receiver_id_idx` (`receiver_id`),
KEY `message_sent_at_idx` (`sent_at`),
CONSTRAINT `message_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `message_receiver_id_fkey` FOREIGN KEY (`receiver_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
CONSTRAINT `message_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post` (`post_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ======================
Table: report
====================== */
CREATE TABLE `report` (
`report_id` VARCHAR(191) NOT NULL,
`post_id` VARCHAR(191) NOT NULL,
`user_id` VARCHAR(191) NOT NULL,
`reported_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
PRIMARY KEY (`report_id`),
KEY `report_post_id_idx` (`post_id`),
KEY `report_user_id_idx` (`user_id`),
KEY `report_reported_at_idx` (`reported_at`),
CONSTRAINT `report_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post` (`post_id`) ON DELETE CASCADE,
CONSTRAINT `report_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;