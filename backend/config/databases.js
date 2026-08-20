import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './index.js';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库配置统一管理
export const databases = {
  // 主数据库 - 存储文章、用户等业务数据
  main: new Sequelize({
    dialect: 'sqlite',
    storage: path.resolve(__dirname, '../', config.db.storage),
    logging: config.db.logging,
    dialectModule: sqlite3
  }),

  // 安全数据库 - 存储密码、令牌等安全相关数据
  security: new Sequelize({
    dialect: 'sqlite',
    storage: path.resolve(__dirname, '../', config.db.securityStorage),
    logging: config.db.logging,
    dialectModule: sqlite3
  })
};

// 数据库连接测试
export const testConnections = async () => {
  try {
    await databases.main.authenticate();
    console.log('✅ 主数据库连接成功');
    
    await databases.security.authenticate();
    console.log('✅ 安全数据库连接成功');
    
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    return false;
  }
};

// 同步所有数据库模型
export const syncDatabases = async () => {
  try {
    await databases.main.sync({ alter: config.nodeEnv !== 'production' });
    console.log('✅ 主数据库模型同步完成');
    
    await databases.security.sync({ alter: config.nodeEnv !== 'production' });
    const queryInterface = databases.security.getQueryInterface();
    const passwordColumns = await queryInterface.describeTable('passwords');
    if (!passwordColumns.sessionVersion) {
      await queryInterface.addColumn('passwords', 'sessionVersion', {
        type: 'INTEGER',
        allowNull: false,
        defaultValue: 1,
      });
    }
    console.log('✅ 安全数据库模型同步完成');
    
    return true;
  } catch (error) {
    console.error('❌ 数据库同步失败:', error);
    return false;
  }
};

// 关闭所有数据库连接
export const closeConnections = async () => {
  try {
    await databases.main.close();
    await databases.security.close();
    console.log('✅ 数据库连接已关闭');
  } catch (error) {
    console.error('❌ 关闭数据库连接失败:', error);
  }
};

// 向后兼容的导出
export const sequelize = databases.main;
export const securitySequelize = databases.security;
