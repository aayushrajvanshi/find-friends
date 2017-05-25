import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('Mapping', new Schema({
    email_id: String,
    friend_email_id: String    
}));