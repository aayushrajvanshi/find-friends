import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('Location', new Schema({
    email_id: String,
    latitude: Number,
    longitude: Number
}));